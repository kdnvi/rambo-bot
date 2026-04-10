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

var cursePending sync.Map

func Curse(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	curserID := i.ActingUser().ID

	targetOpt := i.Data.GetOption("player")
	if targetOpt == nil {
		replyErr(ctx, b, i, "❌ Thiếu mục tiêu.")
		return
	}
	targetID := targetOpt.String()

	if targetID == curserID {
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       "🪞  Tự nguyền mình?",
				Description: "Tự nguyền bản thân? Đó gọi là trầm cảm, không phải bùa chú.",
				Color:       0xFEE75C,
			}},
		})
		return
	}

	if _, loaded := cursePending.LoadOrStore(curserID, struct{}{}); loaded {
		replyErr(ctx, b, i, "⏳ Đang xử lý, đợi xíu...")
		return
	}
	defer cursePending.Delete(curserID)

	players, err := b.DB.ReadPlayers(ctx)
	if err != nil || players[curserID] == nil {
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       "❌  Chưa đăng ký",
				Description: "Bạn cần `/register` trước.",
				Color:       0xED4245,
			}},
		})
		return
	}
	if players[targetID] == nil {
		replyErr(ctx, b, i, "❌ Người chơi đó chưa đăng ký.")
		return
	}

	matches, err := b.DB.ReadMatches(ctx)
	if err != nil {
		replyErr(ctx, b, i, "❌ Không có dữ liệu trận đấu.")
		return
	}
	match := findNextMatch(matches)
	if match == nil {
		replyErr(ctx, b, i, "❌ Không có trận đấu sắp tới để nguyền.")
		return
	}

	curses, _ := b.DB.ReadCurses(ctx)
	matchIDStr := fmt.Sprintf("%d", match.ID)
	if existing := curses[matchIDStr][curserID]; existing != nil {
		existingName := b.UserDisplayName(existing.Target)
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       "⚠️  Đã nguyền rồi",
				Description: fmt.Sprintf("Nguyền **%s** ở Trận #%d rồi. Đợi kết quả xong hãy nguyền tiếp.", existingName, match.ID),
				Color:       0xFEE75C,
			}},
		})
		return
	}

	if err := b.DB.SetCurse(ctx, curserID, targetID, match.ID); err != nil {
		replyErr(ctx, b, i, "❌ Có lỗi xảy ra.")
		return
	}

	targetName := b.UserDisplayName(targetID)
	curseLine := flavor.PickLine(ctx, b.DB, "curse")
	user := i.ActingUser()

	embed := discord.Embed{
		Title: "🧿  LỜI NGUYỀN KÍCH HOẠT",
		Description: fmt.Sprintf(
			"**<@%s>** %s **%s**!\n\n⚽ **Trận #%d:** %s vs %s\n\n**%s** đoán sai → bạn ăn **5 điểm** của **%s**.\n**%s** đoán đúng → bạn mất **5 điểm** cho **%s**.\n\n*Chọn người cho kỹ nha...*",
			user.ID, curseLine, targetName,
			match.ID, upper(match.Home), upper(match.Away),
			targetName, targetName,
			targetName, targetName,
		),
		Color:     0x9B59B6,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	targetAvatarURL := ""
	if u := b.GetCachedUser(targetID); u != nil {
		targetAvatarURL = u.AvatarURL
	}
	if targetAvatarURL != "" {
		embed.Thumbnail = &discord.EmbedImage{URL: targetAvatarURL}
	}

	reply(ctx, b, i, discord.InteractionCallbackData{Embeds: []discord.Embed{embed}})
}

func Uncurse(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	curserID := i.ActingUser().ID

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

	curses, _ := b.DB.ReadCurses(ctx)
	matchIDStr := fmt.Sprintf("%d", match.ID)
	if curses[matchIDStr][curserID] == nil {
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       "⚠️  Không có lời nguyền",
				Description: fmt.Sprintf("Không có lời nguyền nào cho trận `#%d` để huỷ.", match.ID),
				Color:       0xFEE75C,
			}},
		})
		return
	}

	if err := b.DB.RemoveCurse(ctx, curserID, match.ID); err != nil {
		replyErr(ctx, b, i, "❌ Có lỗi xảy ra.")
		return
	}

	reply(ctx, b, i, discord.InteractionCallbackData{
		Embeds: []discord.Embed{{
			Title:       "✅  Huỷ lời nguyền",
			Description: fmt.Sprintf("Đã huỷ lời nguyền cho trận `#%d`.", match.ID),
			Color:       0x57F287,
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
		}},
	})
}
