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

func Group(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	tournamentName := getTournamentName(ctx, b)

	groups, err := b.DB.ReadGroups(ctx)
	if err != nil || groups == nil {
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       "📊  Chưa có bảng",
				Description: "Chưa có dữ liệu bảng.",
				Color:       0xFEE75C,
			}},
		})
		return
	}

	var requested string
	if opt := i.Data.GetOption("name"); opt != nil {
		requested = strings.ToLower(opt.String())
	}

	if requested != "" && groups[requested] == nil {
		keys := make([]string, 0, len(groups))
		for k := range groups {
			keys = append(keys, "`"+strings.ToUpper(k)+"`")
		}
		sort.Strings(keys)
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       "❌  Không tìm thấy bảng",
				Description: fmt.Sprintf("Không có bảng `%s`. Chỉ có: %s", strings.ToUpper(requested), strings.Join(keys, ", ")),
				Color:       0xED4245,
			}},
		})
		return
	}

	groupKeys := []string{}
	if requested != "" {
		groupKeys = []string{requested}
	} else {
		for k := range groups {
			groupKeys = append(groupKeys, k)
		}
		sort.Strings(groupKeys)
	}

	buildBlock := func(key string, teams map[string]*firebase.GroupTeamStats) string {
		type teamEntry struct {
			name string
			*firebase.GroupTeamStats
		}
		entries := make([]teamEntry, 0, len(teams))
		for name, s := range teams {
			entries = append(entries, teamEntry{name, s})
		}
		sort.Slice(entries, func(a, b int) bool {
			ea, eb := entries[a], entries[b]
			if ea.Points != eb.Points {
				return ea.Points > eb.Points
			}
			if ea.GoalDifference != eb.GoalDifference {
				return ea.GoalDifference > eb.GoalDifference
			}
			return ea.For > eb.For
		})
		rows := make([]string, 0, len(entries))
		for idx, t := range entries {
			gd := fmt.Sprintf("+%d", t.GoalDifference)
			if t.GoalDifference < 0 {
				gd = fmt.Sprintf("%d", t.GoalDifference)
			}
			rows = append(rows, fmt.Sprintf("`%d.` **%s** · %dW %dD %dL · %s · **%d**pts",
				idx+1, strings.ToUpper(t.name), t.Won, t.Drawn, t.Lost, gd, t.Points))
		}
		return fmt.Sprintf("📊 **Group %s**\n%s", strings.ToUpper(key), joinLines(rows, "\n"))
	}

	blocks := make([]string, 0, len(groupKeys))
	for _, key := range groupKeys {
		blocks = append(blocks, buildBlock(key, groups[key]))
	}

	if requested != "" {
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       fmt.Sprintf("📊  %s — Bảng đấu", tournamentName),
				Description: blocks[0],
				Color:       0x5865F2,
				Timestamp:   time.Now().UTC().Format(time.RFC3339),
			}},
		})
		return
	}

	// Multiple groups — chunk into embeds of 3 groups each
	const groupsPerEmbed = 3
	embeds := []discord.Embed{{
		Title:     fmt.Sprintf("📊  %s — Bảng đấu", tournamentName),
		Color:     0x5865F2,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}}
	for start := 0; start < len(blocks); start += groupsPerEmbed {
		end := start + groupsPerEmbed
		if end > len(blocks) {
			end = len(blocks)
		}
		embeds = append(embeds, discord.Embed{
			Description: strings.Join(blocks[start:end], "\n\n"),
			Color:       0x5865F2,
		})
	}

	// Send first batch (up to 10 embeds)
	first := embeds
	if len(first) > 10 {
		first = first[:10]
	}
	replyEphemeral(ctx, b, i, discord.InteractionCallbackData{Embeds: first})
	for start := 10; start < len(embeds); start += 10 {
		end := start + 10
		if end > len(embeds) {
			end = len(embeds)
		}
		followup(ctx, b, i, discord.SendMessagePayload{Embeds: embeds[start:end]})
	}
}
