package commands

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/discord"
	"github.com/kdnvi/rambo-bot/internal/flavor"
)

var doubleDownPending sync.Map

func DoubleDown(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	userID := i.ActingUser().ID

	if _, loaded := doubleDownPending.LoadOrStore(userID, struct{}{}); loaded {
		replyErr(ctx, b, i, "⏳ Đang xử lý, đợi xíu...")
		return
	}
	defer doubleDownPending.Delete(userID)

	players, err := b.DB.ReadPlayers(ctx)
	if err != nil || players[userID] == nil {
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       "❌  Chưa đăng ký",
				Description: "Bạn cần `/register` trước.",
				Color:       0xED4245,
			}},
		})
		return
	}

	matches, err := b.DB.ReadMatches(ctx)
	if err != nil || len(matches) == 0 {
		replyErr(ctx, b, i, "❌ Không có dữ liệu trận đấu.")
		return
	}

	match := findNextMatch(matches)
	if match == nil {
		replyErr(ctx, b, i, "❌ Không có trận nào sắp tới.")
		return
	}

	matchID := match.ID
	matchDay := matchDayOf(match.Date)

	// Collect same-day match IDs
	sameDayIDs := []int{}
	for _, m := range matches {
		if matchDayOf(m.Date) == matchDay {
			sameDayIDs = append(sameDayIDs, m.ID)
		}
	}

	myWagers, _ := b.DB.ReadUserWagers(ctx, userID)

	if w := myWagers[fmt.Sprintf("%d", matchID)]; w != nil && w.DoubleDown {
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       "⚠️  Đã dùng rồi",
				Description: fmt.Sprintf("Trận `#%d` đã double-down rồi!", matchID),
				Color:       0xFEE75C,
			}},
		})
		return
	}

	usedID := 0
	for _, id := range sameDayIDs {
		if w := myWagers[fmt.Sprintf("%d", id)]; w != nil && w.DoubleDown {
			usedID = id
			break
		}
	}
	if usedID != 0 {
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       "⚠️  Đã dùng rồi",
				Description: fmt.Sprintf("Xài double-down cho trận `#%d` rồi. Mỗi ngày một phát thôi, tham quá!", usedID),
				Color:       0xFEE75C,
			}},
		})
		return
	}

	if err := b.DB.SetPlayerWager(ctx, userID, matchID, "doubleDown"); err != nil {
		replyErr(ctx, b, i, "❌ Có lỗi xảy ra.")
		return
	}

	stake := getMatchStake(matchID)
	hypeLine := flavor.PickLine(ctx, b.DB, "hype")
	user := i.ActingUser()

	embed := discord.Embed{
		Title: "⏫  DOUBLE DOWN!",
		Description: fmt.Sprintf("**<@%s>** %s\n\n⚽ **Trận #%d:** %s vs %s\n💰 Mức cược: %d → **%d pts**\n\n✅ Đúng → **ăn gấp đôi**\n❌ Sai → **mất gấp đôi**",
			user.ID, hypeLine, matchID, upper(match.Home), upper(match.Away), stake, stake*2),
		Color:     0x57F287,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	if url := user.AvatarURL(); url != "" {
		embed.Thumbnail = &discord.EmbedImage{URL: url}
	}

	reply(ctx, b, i, discord.InteractionCallbackData{Embeds: []discord.Embed{embed}})
}

func UndoDoubleDown(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	userID := i.ActingUser().ID

	matches, err := b.DB.ReadMatches(ctx)
	if err != nil {
		replyErr(ctx, b, i, "❌ Không có dữ liệu trận đấu.")
		return
	}
	match := findNextMatch(matches)
	if match == nil {
		replyErr(ctx, b, i, "❌ Không có trận nào sắp tới.")
		return
	}

	myWagers, _ := b.DB.ReadUserWagers(ctx, userID)
	if w := myWagers[fmt.Sprintf("%d", match.ID)]; w == nil || !w.DoubleDown {
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       "⚠️  Chưa double-down",
				Description: fmt.Sprintf("Trận `#%d` chưa có double-down nào để huỷ.", match.ID),
				Color:       0xFEE75C,
			}},
		})
		return
	}

	if err := b.DB.RemovePlayerWager(ctx, userID, match.ID, "doubleDown"); err != nil {
		replyErr(ctx, b, i, "❌ Có lỗi xảy ra.")
		return
	}

	reply(ctx, b, i, discord.InteractionCallbackData{
		Embeds: []discord.Embed{{
			Title:       "✅  Huỷ double-down",
			Description: fmt.Sprintf("Đã huỷ double-down cho trận `#%d`.", match.ID),
			Color:       0x57F287,
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
		}},
	})
}

// matchDayOf returns the date string (YYYY-MM-DD) in VN timezone for a match date.
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
