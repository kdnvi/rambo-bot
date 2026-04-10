package commands

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/discord"
)

func Rank(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	tournamentName := getTournamentName(ctx, b)

	players, err := b.DB.ReadPlayers(ctx)
	if err != nil || len(players) == 0 {
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       fmt.Sprintf("🏆  %s Bảng xếp hạng", tournamentName),
				Description: "Chưa ai đăng ký cả. `/register` đi rồi chiến!",
				Color:       0xFEE75C,
			}},
		})
		return
	}

	allBadges, _ := b.DB.ReadAllBadges(ctx)
	users := b.GetAllCachedUsers()

	type entry struct {
		id      string
		name    string
		points  float64
		matches int
		avatar  string
		badges  string
	}

	ranked := make([]entry, 0, len(players))
	for id, p := range players {
		name := "Unknown"
		avatar := ""
		if u := users[id]; u != nil {
			name = u.DisplayName()
			avatar = u.AvatarURL
		}
		ranked = append(ranked, entry{
			id:      id,
			name:    name,
			points:  p.Points,
			matches: p.Matches,
			avatar:  avatar,
			badges:  formatBadges(allBadges[id]),
		})
	}
	sort.Slice(ranked, func(a, b int) bool {
		return ranked[a].points > ranked[b].points
	})

	medals := []string{"🥇", "🥈", "🥉"}
	lines := make([]string, 0, len(ranked))
	for idx, p := range ranked {
		rank := fmt.Sprintf("`%d.`", idx+1)
		if idx < len(medals) {
			rank = medals[idx]
		}
		badges := ""
		if p.badges != "" {
			badges = "  " + p.badges
		}
		lines = append(lines, fmt.Sprintf("%s **%s** — %s  *(%d trận)*%s",
			rank, p.name, fmtVND(p.points), p.matches, badges))
	}

	desc := joinLines(lines, "\n")
	if len(desc) > 4096 {
		desc = desc[:4093] + "..."
	}

	embed := discord.Embed{
		Title:       fmt.Sprintf("🏆  %s Bảng xếp hạng", tournamentName),
		Description: desc,
		Color:       0xFFD700,
		Footer:      &discord.EmbedFooter{Text: fmt.Sprintf("%d chiến binh", len(ranked))},
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}
	if len(ranked) > 0 && ranked[0].avatar != "" {
		embed.Thumbnail = &discord.EmbedImage{URL: ranked[0].avatar}
	}

	reply(ctx, b, i, discord.InteractionCallbackData{Embeds: []discord.Embed{embed}})
}
