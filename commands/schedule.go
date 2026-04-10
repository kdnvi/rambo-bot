package commands

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/discord"
	"github.com/kdnvi/rambo-bot/internal/firebase"
)

func Schedule(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	tournamentName := getTournamentName(ctx, b)

	count := int64(5)
	if opt := i.Data.GetOption("count"); opt != nil {
		count = opt.Int()
	}

	matches, err := b.DB.ReadMatches(ctx)
	if err != nil || matches == nil {
		replyErr(ctx, b, i, "❌ Không có dữ liệu trận đấu.")
		return
	}

	now := time.Now()
	var upcoming []firebase.Match
	for _, m := range matches {
		t, err := time.Parse(time.RFC3339, m.Date)
		if err != nil {
			continue
		}
		if t.After(now) && !m.HasResult {
			upcoming = append(upcoming, m)
		}
	}
	sort.Slice(upcoming, func(a, b int) bool {
		ta, _ := time.Parse(time.RFC3339, upcoming[a].Date)
		tb, _ := time.Parse(time.RFC3339, upcoming[b].Date)
		return ta.Before(tb)
	})
	if int64(len(upcoming)) > count {
		upcoming = upcoming[:count]
	}

	if len(upcoming) == 0 {
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       "📅  Không có trận sắp tới",
				Description: "Hết trận rồi, hoặc chưa có lịch mới.",
				Color:       0xFEE75C,
			}},
		})
		return
	}

	lines := make([]string, 0, len(upcoming))
	for _, m := range upcoming {
		ts := unixTS(m.Date)
		lines = append(lines, fmt.Sprintf(
			"**#%d**  %s vs %s\n> 🕐 <t:%d:f> (<t:%d:R>)\n> 🏟️ %s",
			m.ID, upper(m.Home), upper(m.Away), ts, ts, m.Location,
		))
	}

	desc := joinLines(lines, "\n\n")
	replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
		Embeds: []discord.Embed{{
			Title:       fmt.Sprintf("📅  %s — Lịch thi đấu sắp tới", tournamentName),
			Description: desc,
			Color:       0x5865F2,
			Footer:      &discord.EmbedFooter{Text: fmt.Sprintf("%d trận tiếp theo", len(upcoming))},
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
		}},
	})
}
