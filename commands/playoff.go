package commands

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/discord"
	"github.com/kdnvi/rambo-bot/internal/firebase"
)

const r32FirstMatchID = 73

var r32MatchIDs = func() map[int]bool {
	m := map[int]bool{}
	for id := r32FirstMatchID; id < r32FirstMatchID+16; id++ {
		m[id] = true
	}
	return m
}()

func Playoff(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	tournamentName := getTournamentName(ctx, b)

	groups, err := b.DB.ReadGroups(ctx)
	allMatches, err2 := b.DB.ReadMatches(ctx)
	if err != nil || err2 != nil || groups == nil || allMatches == nil {
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       "🏆  Không có dữ liệu",
				Description: "Chưa có dữ liệu bảng hoặc trận đấu.",
				Color:       0xFEE75C,
			}},
		})
		return
	}

	// Check if all group-stage matches are done
	var pendingGroup []firebase.Match
	for _, m := range allMatches {
		if m.ID < r32FirstMatchID && !m.HasResult {
			pendingGroup = append(pendingGroup, m)
		}
	}
	if len(pendingGroup) > 0 {
		sample := pendingGroup
		if len(sample) > 3 {
			sample = sample[:3]
		}
		lines := make([]string, 0, len(sample))
		for _, m := range sample {
			lines = append(lines, fmt.Sprintf("`#%d` %s vs %s", m.ID, upper(m.Home), upper(m.Away)))
		}
		more := ""
		if len(pendingGroup) > 3 {
			more = fmt.Sprintf("\n…và **%d** trận nữa", len(pendingGroup)-3)
		}
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title: "⏳  Vòng bảng chưa xong",
				Description: fmt.Sprintf("Còn **%d** trận vòng bảng chưa có kết quả.\n\n%s%s",
					len(pendingGroup), joinLines(lines, "\n"), more),
				Color: 0xFEE75C,
			}},
		})
		return
	}

	standings := buildGroupStandings(groups)
	thirdPlace := getThirdPlaceRanking(standings)
	qualified := thirdPlace
	if len(qualified) > 8 {
		qualified = qualified[:8]
	}

	// Build bracket
	type bracketPair struct {
		id         int
		homeLabel  string
		homeTeam   string
		awayLabel  string
		awayTeam   string
	}

	thirdIdx := 0
	var pairs []bracketPair
	for _, m := range allMatches {
		if !r32MatchIDs[m.ID] {
			continue
		}
		resolve := func(code string) (label, team string) {
			if code == "3rd" {
				if thirdIdx < len(qualified) {
					t := qualified[thirdIdx]
					thirdIdx++
					return fmt.Sprintf("%s3", strings.ToUpper(t.group)), t.name
				}
				return "3rd", ""
			}
			if len(code) == 2 {
				pos := int(code[0] - '1')
				group := strings.ToLower(string(code[1]))
				if teams, ok := standings[group]; ok && pos < len(teams) {
					return code, teams[pos].name
				}
			}
			return code, ""
		}
		hl, ht := resolve(m.Home)
		al, at := resolve(m.Away)
		pairs = append(pairs, bracketPair{m.ID, hl, ht, al, at})
	}

	lines := make([]string, 0, len(pairs))
	for _, p := range pairs {
		home := upper(p.homeTeam)
		away := upper(p.awayTeam)
		if home == "" {
			home = "TBD"
		}
		if away == "" {
			away = "TBD"
		}
		lines = append(lines, fmt.Sprintf("`#%d`  **%s**  vs  **%s**\n> %s vs %s",
			p.id, home, away, p.homeLabel, p.awayLabel))
	}

	embeds := []discord.Embed{{
		Title:       fmt.Sprintf("🏆  %s — Vòng 32", tournamentName),
		Description: fmt.Sprintf("**%d cặp đấu** theo BXH hiện tại", len(pairs)),
		Color:       0xFFD700,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}}

	const chunkSize = 8
	for start := 0; start < len(lines); start += chunkSize {
		end := start + chunkSize
		if end > len(lines) {
			end = len(lines)
		}
		embeds = append(embeds, discord.Embed{
			Description: strings.Join(lines[start:end], "\n\n"),
			Color:       0x5865F2,
		})
	}

	if len(qualified) > 0 {
		thirdLines := make([]string, 0, len(qualified))
		for idx, t := range qualified {
			gd := fmt.Sprintf("+%d", t.goalDiff)
			if t.goalDiff < 0 {
				gd = fmt.Sprintf("%d", t.goalDiff)
			}
			thirdLines = append(thirdLines, fmt.Sprintf("`%d.` **%s** (%s) — %d pts, %s GD",
				idx+1, upper(t.name), strings.ToUpper(t.group), t.points, gd))
		}
		eliminated := thirdPlace[len(qualified):]
		for _, t := range eliminated {
			gd := fmt.Sprintf("+%d", t.goalDiff)
			if t.goalDiff < 0 {
				gd = fmt.Sprintf("%d", t.goalDiff)
			}
			thirdLines = append(thirdLines, fmt.Sprintf("~~%s (%s) — %d pts, %s GD~~",
				upper(t.name), strings.ToUpper(t.group), t.points, gd))
		}
		embeds = append(embeds, discord.Embed{
			Title:       "📋  Đội xếp thứ 3 tốt nhất",
			Description: joinLines(thirdLines, "\n"),
			Color:       0x57F287,
		})
	}

	first := embeds
	if len(first) > 10 {
		first = first[:10]
	}
	reply(ctx, b, i, discord.InteractionCallbackData{Embeds: first})
	for start := 10; start < len(embeds); start += 10 {
		end := start + 10
		if end > len(embeds) {
			end = len(embeds)
		}
		followup(ctx, b, i, discord.SendMessagePayload{Embeds: embeds[start:end]})
	}
}

// --- Group standings helpers ---

type standingEntry struct {
	name     string
	group    string
	points   int
	goalDiff int
	forGoals int
}

func buildGroupStandings(groups map[string]map[string]*firebase.GroupTeamStats) map[string][]standingEntry {
	standings := map[string][]standingEntry{}
	for key, teams := range groups {
		entries := make([]standingEntry, 0, len(teams))
		for name, s := range teams {
			entries = append(entries, standingEntry{
				name:     name,
				group:    key,
				points:   s.Points,
				goalDiff: s.GoalDifference,
				forGoals: s.For,
			})
		}
		sort.Slice(entries, func(a, b int) bool {
			ea, eb := entries[a], entries[b]
			if ea.points != eb.points {
				return ea.points > eb.points
			}
			if ea.goalDiff != eb.goalDiff {
				return ea.goalDiff > eb.goalDiff
			}
			return ea.forGoals > eb.forGoals
		})
		standings[key] = entries
	}
	return standings
}

func getThirdPlaceRanking(standings map[string][]standingEntry) []standingEntry {
	var thirds []standingEntry
	for group, entries := range standings {
		if len(entries) >= 3 {
			t := entries[2]
			t.group = group
			thirds = append(thirds, t)
		}
	}
	sort.Slice(thirds, func(a, b int) bool {
		ea, eb := thirds[a], thirds[b]
		if ea.points != eb.points {
			return ea.points > eb.points
		}
		if ea.goalDiff != eb.goalDiff {
			return ea.goalDiff > eb.goalDiff
		}
		return ea.forGoals > eb.forGoals
	})
	return thirds
}
