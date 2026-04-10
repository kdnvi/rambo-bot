package badges

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/discord"
	"github.com/kdnvi/rambo-bot/internal/firebase"
	"github.com/kdnvi/rambo-bot/internal/football"
)

// BadgeDef holds display info for a badge — mirrors JS BADGE_DEFS.
type BadgeDef struct {
	ID   string
	Icon string
	Name string
	Desc string
}

// BadgeDefs is the canonical list, matching JS BADGE_DEFS exactly.
var BadgeDefs = []BadgeDef{
	{"first_blood", "🩸", "Máu Đầu", "Đúng ngay lần đầu tiên"},
	{"oracle", "🔮", "Thầy Bói", "Đúng 5 trận liền"},
	{"on_fire", "🔥", "Cháy", "Đúng 3 trận liền"},
	{"underdog", "🐺", "Sói Đơn Độc", "Đúng 3 lần khi ít người chọn"},
	{"bankrupt", "💀", "Vỡ Nợ", "Âm điểm"},
	{"comeback", "🦅", "Hồi Sinh", "Từ âm điểm leo lên dương"},
	{"perfect_day", "💎", "Ngày Hoàn Hảo", "Đúng hết mọi trận trong ngày"},
	{"double_trouble", "⏫", "Double Trouble", "Xài double-down 5 lần"},
	{"streak_breaker", "💔", "Gãy Chuỗi", "Sai sau khi đúng 3+ trận liền"},
}

var badgeMap = func() map[string]BadgeDef {
	m := make(map[string]BadgeDef, len(BadgeDefs))
	for _, b := range BadgeDefs {
		m[b.ID] = b
	}
	return m
}()

// FormatBadges returns emoji icons for a player's badges.
func FormatBadges(storedBadges map[string]*firebase.Badge) string {
	if len(storedBadges) == 0 {
		return ""
	}
	var icons []string
	for _, def := range BadgeDefs {
		if _, ok := storedBadges[def.ID]; ok {
			icons = append(icons, def.Icon)
		}
	}
	return strings.Join(icons, " ")
}

// FormatBadgesDetailed returns detailed badge descriptions.
func FormatBadgesDetailed(storedBadges map[string]*firebase.Badge) string {
	if len(storedBadges) == 0 {
		return "*Chưa có gì cả*"
	}
	var lines []string
	for _, def := range BadgeDefs {
		if _, ok := storedBadges[def.ID]; ok {
			lines = append(lines, fmt.Sprintf("%s **%s** — %s", def.Icon, def.Name, def.Desc))
		}
	}
	if len(lines) == 0 {
		return "*Chưa có gì cả*"
	}
	return strings.Join(lines, "\n")
}

// CheckAndAward evaluates all badge conditions after match calculation
// and announces all newly awarded badges in a single embed — mirrors JS exactly.
func CheckAndAward(ctx context.Context, b *bot.Bot, completedMatches []firebase.Match, lastMatchID int) {
	players, err := b.DB.ReadPlayers(ctx)
	if err != nil || len(players) == 0 {
		return
	}
	votes, err := b.DB.ReadAllVotes(ctx)
	if err != nil {
		votes = nil
	}
	wagers, err := b.DB.ReadPlayerWagers(ctx)
	if err != nil {
		wagers = nil
	}
	existingBadges, err := b.DB.ReadAllBadges(ctx)
	if err != nil {
		existingBadges = nil
	}

	newBadges := checkAndAwardBadges(ctx, b, players, completedMatches, votes, wagers, existingBadges, lastMatchID)

	if len(newBadges) == 0 {
		return
	}

	channelID := channelFromConfig(ctx, b)
	if channelID == "" {
		return
	}
	announceBadges(ctx, b, channelID, newBadges)
}

// checkAndAwardBadges mirrors JS checkAndAwardBadges logic exactly.
// Badges only count explicit votes — randomized picks are excluded.
func checkAndAwardBadges(
	ctx context.Context,
	b *bot.Bot,
	players map[string]*firebase.Player,
	completedMatches []firebase.Match,
	votes map[string]map[string]map[string]*firebase.Vote,
	wagers map[string]map[string]*firebase.Wager,
	existingBadges map[string]map[string]*firebase.Badge,
	lastMatchID int,
) map[string][]BadgeDef {
	newBadges := map[string][]BadgeDef{}

	for userID := range players {
		playerBadges := existingBadges[userID]
		has := func(id string) bool {
			_, ok := playerBadges[id]
			return ok
		}

		var results []matchResult
		matchDays := map[string][]bool{}

		for _, match := range completedMatches {
			key := fmt.Sprintf("%d", match.ID-1)
			winner := football.GetWinner(&match)
			userVote := getMatchVote(votes, key, match.MessageID, userID)
			if userVote == "" {
				continue // skip auto/random picks — badges require active participation
			}
			isCorrect := userVote == winner
			r := matchResult{matchID: match.ID, isCorrect: isCorrect, date: match.Date}
			if isCorrect && isMinorityPick(votes, key, match.MessageID, userVote) {
				r.minorityWin = true
			}
			results = append(results, r)

			day := matchDay(match.Date)
			matchDays[day] = append(matchDays[day], isCorrect)
		}

		var earned []string

		if !has("first_blood") {
			for _, r := range results {
				if r.isCorrect {
					earned = append(earned, "first_blood")
					break
				}
			}
		}

		maxWinStreak := longestStreak(results, true)
		if !has("oracle") && maxWinStreak >= 5 {
			earned = append(earned, "oracle")
		}
		if !has("on_fire") && maxWinStreak >= 3 {
			earned = append(earned, "on_fire")
		}

		if !has("streak_breaker") && hasStreakThenLoss(results, 3) {
			earned = append(earned, "streak_breaker")
		}

		minorityWins := 0
		for _, r := range results {
			if r.minorityWin {
				minorityWins++
			}
		}
		if !has("underdog") && minorityWins >= 3 {
			earned = append(earned, "underdog")
		}

		p := players[userID]
		if !has("bankrupt") && p != nil && p.Points < 0 {
			earned = append(earned, "bankrupt")
		}
		if !has("comeback") && p != nil && p.HadNegativeBalance && p.Points > 0 {
			earned = append(earned, "comeback")
		}

		if !has("perfect_day") {
			for _, dayResults := range matchDays {
				if len(dayResults) >= 2 {
					allCorrect := true
					for _, c := range dayResults {
						if !c {
							allCorrect = false
							break
						}
					}
					if allCorrect {
						earned = append(earned, "perfect_day")
						break
					}
				}
			}
		}

		if !has("double_trouble") {
			ddCount := 0
			if uw := wagers[userID]; uw != nil {
				for _, w := range uw {
					if w != nil && w.DoubleDown {
						ddCount++
					}
				}
			}
			if ddCount >= 5 {
				earned = append(earned, "double_trouble")
			}
		}

		if len(earned) == 0 {
			continue
		}

		var userNewBadges []BadgeDef
		for _, badgeID := range earned {
			awarded, err := b.DB.AwardBadge(ctx, userID, badgeID, map[string]interface{}{"matchId": lastMatchID})
			if err != nil {
				slog.Error("award badge failed", "user", userID, "badge", badgeID, "err", err)
				continue
			}
			if awarded {
				userNewBadges = append(userNewBadges, badgeMap[badgeID])
				slog.Info("new badge", "badge", badgeID, "user", userID)
			}
		}
		if len(userNewBadges) > 0 {
			newBadges[userID] = userNewBadges
		}
	}

	return newBadges
}

type matchResult struct {
	matchID     int
	isCorrect   bool
	date        string
	minorityWin bool
}

// announceBadges sends a single embed listing all newly awarded badges — mirrors JS announceBadges.
func announceBadges(ctx context.Context, b *bot.Bot, channelID string, newBadges map[string][]BadgeDef) {
	users := b.GetAllCachedUsers()

	var lines []string
	for userID, earned := range newBadges {
		name := "Unknown"
		if u := users[userID]; u != nil {
			name = u.DisplayName()
		}
		for _, badge := range earned {
			lines = append(lines, fmt.Sprintf("%s **%s** mở khoá **%s**! — *%s*", badge.Icon, name, badge.Name, badge.Desc))
		}
	}

	if len(lines) == 0 {
		return
	}

	embed := discord.Embed{
		Title:       "🏅  Achievement mới!",
		Description: strings.Join(lines, "\n"),
		Color:       0xFFD700,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}

	if _, err := b.REST.SendMessage(ctx, channelID, discord.SendMessagePayload{Embeds: []discord.Embed{embed}}); err != nil {
		slog.Error("announce badges failed", "err", err)
	}
}

func getMatchVote(votes map[string]map[string]map[string]*firebase.Vote, matchIndex, messageID, userID string) string {
	if votes == nil {
		return ""
	}
	byMsg, ok := votes[matchIndex]
	if !ok || messageID == "" {
		return ""
	}
	byUser, ok := byMsg[messageID]
	if !ok {
		return ""
	}
	if v, ok := byUser[userID]; ok && v != nil {
		return v.Vote
	}
	return ""
}

func getMatchVotes(votes map[string]map[string]map[string]*firebase.Vote, matchIndex, messageID string) map[string]*firebase.Vote {
	if votes == nil {
		return nil
	}
	byMsg, ok := votes[matchIndex]
	if !ok || messageID == "" {
		return nil
	}
	return byMsg[messageID]
}

func isMinorityPick(votes map[string]map[string]map[string]*firebase.Vote, matchIndex, messageID, userVote string) bool {
	matchVotes := getMatchVotes(votes, matchIndex, messageID)
	if matchVotes == nil {
		return false
	}
	total := 0
	count := 0
	for _, v := range matchVotes {
		if v == nil {
			continue
		}
		total++
		if v.Vote == userVote {
			count++
		}
	}
	if total == 0 {
		return false
	}
	return count < total/2
}

func longestStreak(results []matchResult, correctValue bool) int {
	max := 0
	current := 0
	for _, r := range results {
		if r.isCorrect == correctValue {
			current++
			if current > max {
				max = current
			}
		} else {
			current = 0
		}
	}
	return max
}

func hasStreakThenLoss(results []matchResult, minStreak int) bool {
	streak := 0
	for _, r := range results {
		if r.isCorrect {
			streak++
		} else {
			if streak >= minStreak {
				return true
			}
			streak = 0
		}
	}
	return false
}

func matchDay(dateStr string) string {
	t, err := time.Parse(time.RFC3339, dateStr)
	if err != nil {
		return dateStr
	}
	loc, _ := time.LoadLocation("Asia/Ho_Chi_Minh")
	if loc == nil {
		loc = time.UTC
	}
	return t.In(loc).Format("2006-01-02")
}

func channelFromConfig(ctx context.Context, b *bot.Bot) string {
	cfg, err := b.DB.ReadTournamentConfig(ctx)
	if err == nil && cfg != nil && cfg.ChannelID != "" {
		return cfg.ChannelID
	}
	return ""
}
