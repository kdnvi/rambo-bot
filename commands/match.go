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

func Match(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	tournamentName := getTournamentName(ctx, b)

	matches, err := b.DB.ReadMatches(ctx)
	if err != nil || matches == nil {
		replyErr(ctx, b, i, "❌ Không có dữ liệu trận đấu.")
		return
	}

	var match *firebase.Match
	if opt := i.Data.GetOption("id"); opt != nil {
		id := int(opt.Int())
		for idx := range matches {
			if matches[idx].ID == id {
				match = &matches[idx]
				break
			}
		}
		if match == nil {
			replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
				Embeds: []discord.Embed{{
					Title:       "❌  Không tìm thấy trận",
					Description: fmt.Sprintf("Không có trận nào ID `%d` cả.", id),
					Color:       0xED4245,
				}},
			})
			return
		}
	} else {
		// Most recent completed match
		sort.Slice(matches, func(a, b int) bool {
			ta, _ := time.Parse(time.RFC3339, matches[a].Date)
			tb, _ := time.Parse(time.RFC3339, matches[b].Date)
			return ta.After(tb)
		})
		for idx := range matches {
			if matches[idx].HasResult {
				match = &matches[idx]
				break
			}
		}
		if match == nil {
			replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
				Embeds: []discord.Embed{{
					Title:       "❌  Không tìm thấy trận",
					Description: "Chưa có trận nào xong.",
					Color:       0xED4245,
				}},
			})
			return
		}
	}

	kickoff, _ := time.Parse(time.RFC3339, match.Date)
	ts := kickoff.Unix()
	now := time.Now()
	hasStarted := kickoff.Before(now)

	var status string
	var color int
	switch {
	case match.HasResult:
		status = fmt.Sprintf("✅ Kết thúc — **%s** %d - %d **%s**",
			upper(match.Home), match.Result.Home, match.Result.Away, upper(match.Away))
		color = 0x57F287
	case hasStarted:
		status = "🔴 Đang đá / chờ kết quả"
		color = 0xED4245
	default:
		status = fmt.Sprintf("🟢 Sắp đá — <t:%d:R>", ts)
		color = 0x5865F2
	}

	stake := getMatchStake(match.ID)
	embed := discord.Embed{
		Title:       fmt.Sprintf("⚽  Match #%d: %s vs %s", match.ID, upper(match.Home), upper(match.Away)),
		Description: fmt.Sprintf("**%s**\n\n%s", tournamentName, status),
		Color:       color,
		Fields: []discord.EmbedField{
			{Name: "🕐 Giờ đá", Value: fmt.Sprintf("<t:%d:f>", ts), Inline: true},
			{Name: "🏟️ Sân", Value: match.Location, Inline: true},
			{Name: "💰 Cược", Value: fmt.Sprintf("%d pts", stake), Inline: true},
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	if hasStarted && match.MessageID != "" {
		votes, err := b.DB.ReadMatchVotes(ctx, match.ID, match.MessageID)
		if err == nil && votes != nil {
			users := b.GetAllCachedUsers()
			winner := getWinner(match)
			grouped := map[string][]string{}
			for uid, v := range votes {
				pick := upper(v.Vote)
				icon := "🗳️"
				if winner != "" {
					if v.Vote == winner {
						icon = "👑"
					} else {
						icon = "🤡"
					}
				}
				name := "Unknown"
				if u := users[uid]; u != nil {
					name = u.DisplayName()
				}
				grouped[pick] = append(grouped[pick], icon+" "+name)
			}
			voteLines := ""
			for pick, names := range grouped {
				voteLines += fmt.Sprintf("**%s**\n%s\n\n", pick, joinLines(names, "\n"))
			}
			if len(voteLines) > 1024 {
				voteLines = voteLines[:1021] + "..."
			}
			if voteLines == "" {
				voteLines = "*Không có vote*"
			}
			embed.Fields = append(embed.Fields, discord.EmbedField{Name: "🗳️ Vote", Value: voteLines})
		} else {
			embed.Fields = append(embed.Fields, discord.EmbedField{Name: "🗳️ Vote", Value: "*Không có vote*"})
		}
	}

	reply(ctx, b, i, discord.InteractionCallbackData{Embeds: []discord.Embed{embed}})
}
