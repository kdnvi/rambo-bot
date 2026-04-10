package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/badges"
	"github.com/kdnvi/rambo-bot/internal/discord"
	"github.com/kdnvi/rambo-bot/internal/firebase"
	"github.com/kdnvi/rambo-bot/internal/flavor"
	"github.com/kdnvi/rambo-bot/internal/football"
)

const (
	defaultMatchPostBeforeMins  = 720
	defaultVoteReminderBeforeMins = 30
	resultReminderAfter          = 3 * time.Hour
)

func getChannelID(ctx context.Context, b *bot.Bot) string {
	cfg, err := b.DB.ReadTournamentConfig(ctx)
	if err == nil && cfg != nil && cfg.ChannelID != "" {
		return cfg.ChannelID
	}
	return os.Getenv("FOOTBALL_CHANNEL_ID")
}

func intEnv(key string, def int) time.Duration {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return time.Duration(n) * time.Minute
		}
	}
	return time.Duration(def) * time.Minute
}

// StartAll launches all background jobs and returns when ctx is cancelled.
func StartAll(ctx context.Context, b *bot.Bot) {
	go matchPostJob(ctx, b)
	go voteReminderJob(ctx, b)
	go calculatingJob(ctx, b)
	go syncUsersJob(ctx, b)
}

// matchPostJob polls every 15 min and posts vote embeds for upcoming matches.
func matchPostJob(ctx context.Context, b *bot.Bot) {
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runMatchPost(ctx, b)
		}
	}
}

func runMatchPost(ctx context.Context, b *bot.Bot) {
	postBefore := intEnv("MATCH_POST_BEFORE_MINS", defaultMatchPostBeforeMins)

	matches, err := b.DB.ReadMatches(ctx)
	if err != nil || len(matches) == 0 {
		return
	}

	now := time.Now()
	var toPost []firebase.Match
	for _, m := range matches {
		if m.MessageID != "" {
			continue
		}
		kickoff, err := time.Parse(time.RFC3339, m.Date)
		if err != nil {
			continue
		}
		timeUntil := kickoff.Sub(now)
		if timeUntil > 0 && timeUntil <= postBefore {
			toPost = append(toPost, m)
		}
	}
	if len(toPost) == 0 {
		return
	}

	cfg, _ := b.DB.ReadTournamentConfig(ctx)
	channelID := getChannelID(ctx, b)

	for _, match := range toPost {
		msg := buildMatchVoteMessage(&match, cfg)
		sent, err := b.REST.SendMessage(ctx, channelID, msg)
		if err != nil {
			slog.Error("failed to post match vote", "match", match.ID, "err", err)
			continue
		}
		slog.Info("posted match vote", "match", match.ID, "messageID", sent.ID)
		if err := b.DB.UpdateMatch(ctx, match.ID-1, map[string]interface{}{"messageId": sent.ID}); err != nil {
			slog.Error("failed to save messageId", "match", match.ID, "err", err)
		}
	}
}

// voteReminderJob polls every 15 min and pings unvoted players before kickoff.
func voteReminderJob(ctx context.Context, b *bot.Bot) {
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runVoteReminder(ctx, b)
		}
	}
}

func runVoteReminder(ctx context.Context, b *bot.Bot) {
	remindBefore := intEnv("VOTE_REMINDER_BEFORE_MINS", defaultVoteReminderBeforeMins)

	matches, err := b.DB.ReadMatches(ctx)
	if err != nil {
		return
	}
	now := time.Now()
	var toRemind []firebase.Match
	for _, m := range matches {
		if m.MessageID == "" || m.Reminded {
			continue
		}
		kickoff, err := time.Parse(time.RFC3339, m.Date)
		if err != nil {
			continue
		}
		timeUntil := kickoff.Sub(now)
		if timeUntil > 0 && timeUntil <= remindBefore {
			toRemind = append(toRemind, m)
		}
	}
	if len(toRemind) == 0 {
		return
	}

	players, err := b.DB.ReadPlayers(ctx)
	if err != nil || len(players) == 0 {
		return
	}
	channelID := getChannelID(ctx, b)
	allPlayerIDs := make([]string, 0, len(players))
	for id := range players {
		allPlayerIDs = append(allPlayerIDs, id)
	}

	for _, match := range toRemind {
		votes, err := b.DB.ReadMatchVotes(ctx, match.ID, match.MessageID)
		if err != nil {
			votes = nil
		}

		var unvoted []string
		for _, id := range allPlayerIDs {
			if votes == nil || votes[id] == nil {
				unvoted = append(unvoted, id)
			}
		}

		if len(unvoted) == 0 {
			_ = b.DB.UpdateMatch(ctx, match.ID-1, map[string]interface{}{"reminded": true})
			continue
		}

		mentions := make([]string, len(unvoted))
		for idx, id := range unvoted {
			mentions[idx] = "<@" + id + ">"
		}
		ts := unixTS(match.Date)

		_, err = b.REST.SendMessage(ctx, channelID, discord.SendMessagePayload{
			Content: strings.Join(mentions, " "),
			Embeds: []discord.Embed{{
				Title: fmt.Sprintf("⏰  Nhắc vote — Trận #%d", match.ID),
				Description: fmt.Sprintf("**%s vs %s**\nCòn <t:%d:R> là đá — vote đi không thì bị gán **đội ít vote nhất**!",
					strings.ToUpper(match.Home), strings.ToUpper(match.Away), ts),
				Color: 0xFEE75C,
			}},
		})
		if err != nil {
			slog.Error("failed to send vote reminder", "match", match.ID, "err", err)
			continue
		}
		_ = b.DB.UpdateMatch(ctx, match.ID-1, map[string]interface{}{"reminded": true})
		slog.Info("sent vote reminder", "match", match.ID, "unvoted", len(unvoted))
	}
}

// calculatingJob polls every 30 min to calculate uncalculated matches and send result reminders.
func calculatingJob(ctx context.Context, b *bot.Bot) {
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runCalculating(ctx, b)
		}
	}
}

func runCalculating(ctx context.Context, b *bot.Bot) {
	matches, err := b.DB.ReadMatches(ctx)
	if err != nil {
		return
	}
	now := time.Now()

	// Calculate uncalculated matches
	var uncalculated []firebase.Match
	for _, m := range matches {
		if m.HasResult && !m.IsCalculated {
			uncalculated = append(uncalculated, m)
		}
	}
		if len(uncalculated) > 0 {
		for idx := range uncalculated {
			if err := football.UpdateGroupStandings(ctx, b.DB, &uncalculated[idx]); err != nil {
				slog.Error("update group standings in job failed", "err", err)
			}
		}
		matchDeltas, err := football.CalculateMatches(ctx, b.DB, uncalculated)
		if err != nil {
			slog.Error("calculate matches in job failed", "err", err)
		}
		// Check matchday MVP and badges after fresh calculation
		freshMatches, err := b.DB.ReadMatches(ctx)
		if err == nil {
			CheckMatchdayMVP(ctx, b, freshMatches, uncalculated)
			if matchDeltas != nil {
				completed := make([]firebase.Match, 0)
				for _, m := range freshMatches {
					if m.HasResult && m.IsCalculated {
						completed = append(completed, m)
					}
				}
				lastID := 0
				for _, m := range uncalculated {
					if m.ID > lastID {
						lastID = m.ID
					}
				}
				badges.CheckAndAward(ctx, b, completed, lastID)
			}
		}
	}

	// Send result reminders for matches that finished >3h ago but have no result
	channelID := getChannelID(ctx, b)
	for _, m := range matches {
		if m.HasResult || m.ResultReminded || m.Date == "" {
			continue
		}
		kickoff, err := time.Parse(time.RFC3339, m.Date)
		if err != nil {
			continue
		}
		if now.Sub(kickoff) < resultReminderAfter {
			continue
		}
		elapsed := now.Sub(kickoff)
		hours := int(elapsed.Hours())
		mins := int(elapsed.Minutes()) % 60

		_, err = b.REST.SendMessage(ctx, channelID, discord.SendMessagePayload{
			Embeds: []discord.Embed{{
				Title: fmt.Sprintf("🔔  Chờ kết quả — Trận #%d", m.ID),
				Description: fmt.Sprintf("**%s vs %s**\nĐá được **%dh %dm** rồi — cập nhật kết quả đi!\n\n`/update-result match-id:%d home-score:? away-score:?`",
					strings.ToUpper(m.Home), strings.ToUpper(m.Away), hours, mins, m.ID),
				Color: 0xED4245,
			}},
		})
		if err != nil {
			slog.Error("failed to send result reminder", "match", m.ID, "err", err)
			continue
		}
		_ = b.DB.UpdateMatch(ctx, m.ID-1, map[string]interface{}{"resultReminded": true})
		slog.Info("sent result reminder", "match", m.ID)
	}
}

// syncUsersJob syncs Discord guild members once daily at 02:00 UTC.
func syncUsersJob(ctx context.Context, b *bot.Bot) {
	for {
		d := nextWallClock(2, 0)
		select {
		case <-ctx.Done():
			return
		case <-time.After(d):
			b.SyncUsers(ctx)
		}
	}
}

// nextWallClock returns the duration until the next occurrence of h:m UTC.
func nextWallClock(h, m int) time.Duration {
	now := time.Now().UTC()
	next := time.Date(now.Year(), now.Month(), now.Day(), h, m, 0, 0, time.UTC)
	if !next.After(now) {
		next = next.Add(24 * time.Hour)
	}
	return time.Until(next)
}

// CheckMatchdayMVP checks if all matches on a matchday are done and announces the day's MVP.
func CheckMatchdayMVP(ctx context.Context, b *bot.Bot, allMatches []firebase.Match, justCalculated []firebase.Match) {
	matchDays := map[string]bool{}
	for _, m := range justCalculated {
		matchDays[matchDayOf(m.Date)] = true
	}

	for day := range matchDays {
		var dayMatches []firebase.Match
		for _, m := range allMatches {
			if matchDayOf(m.Date) == day {
				dayMatches = append(dayMatches, m)
			}
		}
		allDone := len(dayMatches) >= 2
		for _, m := range dayMatches {
			if !m.HasResult || !m.IsCalculated {
				allDone = false
				break
			}
		}
		if !allDone {
			continue
		}
		alreadyAnnounced := false
		for _, m := range dayMatches {
			if m.MvpAnnounced {
				alreadyAnnounced = true
				break
			}
		}
		if alreadyAnnounced {
			continue
		}

		announceMVP(ctx, b, allMatches, dayMatches, day)
	}
}

func announceMVP(ctx context.Context, b *bot.Bot, allMatches, dayMatches []firebase.Match, day string) {
	votes, _ := b.DB.ReadAllVotes(ctx)
	players, err := b.DB.ReadPlayers(ctx)
	if err != nil || len(players) == 0 {
		return
	}
	wagers, _ := b.DB.ReadPlayerWagers(ctx)
	curses, _ := b.DB.ReadCurses(ctx)
	channelID := getChannelID(ctx, b)

	playerIDs := make([]string, 0, len(players))
	for id := range players {
		playerIDs = append(playerIDs, id)
	}
	scores := map[string]float64{}
	for _, id := range playerIDs {
		scores[id] = 0
	}

	for _, match := range dayMatches {
		winner := football.GetWinner(&match)
		if winner == "" {
			continue
		}
		key := fmt.Sprintf("%d", match.ID-1)
		var matchVotes map[string]*firebase.Vote
		if v, ok := votes[key]; ok {
			matchVotes = v[match.MessageID]
		}
		storedRandomPicks := match.RandomPicks

		picks := map[string]string{}
		if matchVotes != nil {
			for id, v := range matchVotes {
				for _, pid := range playerIDs {
					if pid == id {
						picks[id] = v.Vote
						break
					}
				}
			}
		}
		for _, id := range playerIDs {
			if _, ok := picks[id]; !ok {
				if rp, ok := storedRandomPicks[id]; ok {
					picks[id] = rp
				}
			}
		}

		baseStake := football.GetMatchStake(match.ID)
		playerStakes := map[string]int{}
		for id, pick := range picks {
			if pick == "" {
				continue
			}
			multiplier := 1
			if w := wagers[id]; w != nil {
				if wm := w[fmt.Sprintf("%d", match.ID)]; wm != nil && wm.DoubleDown {
					multiplier = 2
				}
			}
			playerStakes[id] = baseStake * multiplier
		}

		validPicks := map[string]string{}
		for id, pick := range picks {
			if pick != "" {
				validPicks[id] = pick
			}
		}

		winnerEntries := []string{}
		loserEntries := []string{}
		for id, pick := range validPicks {
			if pick == winner {
				winnerEntries = append(winnerEntries, id)
			} else {
				loserEntries = append(loserEntries, id)
			}
		}
		totalLoser, totalWinner := 0, 0
		for _, id := range loserEntries {
			totalLoser += playerStakes[id]
		}
		for _, id := range winnerEntries {
			totalWinner += playerStakes[id]
		}
		allWin := len(loserEntries) == 0
		allLose := len(winnerEntries) == 0

		for id, pick := range validPicks {
			isWin := pick == winner
			var delta float64
			if !allWin && !allLose {
				if isWin && totalWinner > 0 {
					delta = float64(playerStakes[id]) / float64(totalWinner) * float64(totalLoser)
				} else if !isWin {
					delta = -float64(playerStakes[id])
				}
			}
			scores[id] += delta
		}

		// Apply curses
		matchCurses := curses[fmt.Sprintf("%d", match.ID)]
		for curserID, c := range matchCurses {
			if _, ok := scores[curserID]; !ok {
				continue
			}
			if _, ok := scores[c.Target]; !ok {
				continue
			}
			targetVote := ""
			if v, ok := matchVotes[c.Target]; ok && v != nil {
				targetVote = v.Vote
			}
			if targetVote == "" {
				targetVote = storedRandomPicks[c.Target]
			}
			if targetVote == "" {
				continue
			}
			if targetVote == winner {
				scores[curserID] -= football.CursePts
				scores[c.Target] += football.CursePts
			} else {
				scores[curserID] += football.CursePts
				scores[c.Target] -= football.CursePts
			}
		}
	}

	// Find MVP
	type kv struct {
		id  string
		pts float64
	}
	ranked := make([]kv, 0, len(scores))
	for id, pts := range scores {
		ranked = append(ranked, kv{id, pts})
	}
	for a := 0; a < len(ranked); a++ {
		for b2 := a + 1; b2 < len(ranked); b2++ {
			if ranked[b2].pts > ranked[a].pts {
				ranked[a], ranked[b2] = ranked[b2], ranked[a]
			}
		}
	}
	if len(ranked) == 0 || ranked[0].pts <= 0 {
		return
	}

	mvp := ranked[0]
	users := b.GetAllCachedUsers()
	nickname := "Unknown"
	avatarURL := ""
	if u := users[mvp.id]; u != nil {
		nickname = u.DisplayName()
		avatarURL = u.AvatarURL
	}

	embed := discord.Embed{
		Title:       "⭐  MVP hôm nay",
		Description: fmt.Sprintf("**%s** cân hết %d trận hôm nay với **+%.2f** điểm!", nickname, len(dayMatches), mvp.pts),
		Color:       0xFFD700,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}
	if avatarURL != "" {
		embed.Thumbnail = &discord.EmbedImage{URL: avatarURL}
	}
	_, err = b.REST.SendMessage(ctx, channelID, discord.SendMessagePayload{Embeds: []discord.Embed{embed}})
	if err != nil {
		slog.Error("failed to announce MVP", "err", err)
	}

	// Check rivalry
	if rivalryEmbed := checkRivalry(ctx, b, allMatches, votes, players, users); rivalryEmbed != nil {
		_, _ = b.REST.SendMessage(ctx, channelID, discord.SendMessagePayload{Embeds: []discord.Embed{*rivalryEmbed}})
	}

	// Mark MVP announced
	for _, m := range dayMatches {
		_ = b.DB.UpdateMatch(ctx, m.ID-1, map[string]interface{}{"mvpAnnounced": true})
	}
	slog.Info("announced matchday MVP", "day", day, "mvp", nickname)
}

func checkRivalry(ctx context.Context, b *bot.Bot, allMatches []firebase.Match, votes map[string]map[string]map[string]*firebase.Vote, players map[string]*firebase.Player, users map[string]*discord.CachedUser) *discord.Embed {
	completed := []firebase.Match{}
	for _, m := range allMatches {
		if m.HasResult && m.IsCalculated {
			completed = append(completed, m)
		}
	}
	if len(completed) < 5 {
		return nil
	}
	playerIDs := make([]string, 0, len(players))
	for id := range players {
		playerIDs = append(playerIDs, id)
	}
	if len(playerIDs) < 2 {
		return nil
	}

	type pairStat struct{ count, total int }
	disagreements := map[string]*pairStat{}

	for _, m := range completed {
		key := fmt.Sprintf("%d", m.ID-1)
		mv, ok := votes[key]
		if !ok {
			continue
		}
		byMsg := mv[m.MessageID]
		if byMsg == nil {
			continue
		}
		for ai := 0; ai < len(playerIDs); ai++ {
			for bi := ai + 1; bi < len(playerIDs); bi++ {
				a, bID := playerIDs[ai], playerIDs[bi]
				va, okA := byMsg[a]
				vb, okB := byMsg[bID]
				if !okA || !okB || va == nil || vb == nil {
					continue
				}
				pair := a + "|" + bID
				if a > bID {
					pair = bID + "|" + a
				}
				if disagreements[pair] == nil {
					disagreements[pair] = &pairStat{}
				}
				disagreements[pair].total++
				if va.Vote != vb.Vote {
					disagreements[pair].count++
				}
			}
		}
	}

	var topPair string
	topCount := 0
	var topStat *pairStat
	for pair, stat := range disagreements {
		if stat.total >= 5 && stat.count > topCount {
			topCount = stat.count
			topPair = pair
			topStat = stat
		}
	}
	if topPair == "" || topCount < 3 {
		return nil
	}
	pct := topStat.count * 100 / topStat.total
	if pct < 50 {
		return nil
	}

	ids := strings.SplitN(topPair, "|", 2)
	nameA, nameB := "Unknown", "Unknown"
	if u := users[ids[0]]; u != nil {
		nameA = u.DisplayName()
	}
	if u := users[ids[1]]; u != nil {
		nameB = u.DisplayName()
	}

	rivalLine := flavor.PickLine(ctx, b.DB, "rival")
	embed := discord.Embed{
		Title:       "⚔️  Kình địch phát hiện",
		Description: fmt.Sprintf("**%s** và **%s** bất đồng **%d** trong **%d** trận (**%d%%**)!\n\n%s", nameA, nameB, topStat.count, topStat.total, pct, rivalLine),
		Color:       0x9B59B6,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}
	return &embed
}

// buildMatchVoteMessage creates the vote embed + buttons for a match.
func buildMatchVoteMessage(match *firebase.Match, cfg *firebase.TournamentConfig) discord.SendMessagePayload {
	tournamentName := "Tournament"
	if cfg != nil && cfg.Name != "" {
		tournamentName = cfg.Name
	}

	kickoff, _ := time.Parse(time.RFC3339, match.Date)
	loc, _ := time.LoadLocation("Asia/Ho_Chi_Minh")
	if loc == nil {
		loc = time.UTC
	}
	timeStr := kickoff.In(loc).Format("02/01/2006 15:04")
	ts := kickoff.Unix()
	stake := football.GetMatchStake(match.ID)

	stakeNote := ""
	if stake > 10 {
		stakeNote = fmt.Sprintf("\n💰 **Cược:** %d điểm (vòng knockout nên mức cược cao!)", stake)
	}

	embed := discord.Embed{
		Title: fmt.Sprintf("⚽  %s  vs  %s", strings.ToUpper(match.Home), strings.ToUpper(match.Away)),
		Description: fmt.Sprintf("**%s** — Match #%d\n\n🕐 **Kickoff:** %s *(VN)* — <t:%d:R>\n🏟️ **Venue:** %s%s",
			tournamentName, match.ID, timeStr, ts, match.Location, stakeNote),
		Color:     0x5865F2,
		Footer:    &discord.EmbedFooter{Text: "Bấm bên dưới để vote trước giờ đá!"},
		Timestamp: kickoff.UTC().Format(time.RFC3339),
	}

	row := discord.ActionRow(
		discord.NewButton(fmt.Sprintf("%d|%s", match.ID, match.Home), strings.ToUpper(match.Home), discord.ButtonSuccess),
		discord.NewButton(fmt.Sprintf("%d|draw", match.ID), "DRAW", discord.ButtonPrimary),
		discord.NewButton(fmt.Sprintf("%d|%s", match.ID, match.Away), strings.ToUpper(match.Away), discord.ButtonDanger),
	)

	return discord.SendMessagePayload{
		Embeds:     []discord.Embed{embed},
		Components: []discord.Component{row},
	}
}

// matchDayOf returns the date string YYYY-MM-DD in VN timezone.
func matchDayOf(dateStr string) string {
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

// unixTS parses an RFC3339 date string to Unix timestamp.
func unixTS(dateStr string) int64 {
	t, err := time.Parse(time.RFC3339, dateStr)
	if err != nil {
		return 0
	}
	return t.Unix()
}
