package commands

import (
	"context"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/discord"
)

func Register(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	userID := i.ActingUser().ID

	err := b.DB.RegisterPlayer(ctx, userID)
	if err != nil && err.Error() == "already_registered" {
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Description: "Đăng ký rồi mà, vô lại làm gì nữa.",
				Color:       0xFEE75C,
			}},
		})
		return
	}
	if err != nil {
		replyErr(ctx, b, i, "❌ Có lỗi xảy ra khi đăng ký.")
		return
	}

	reply(ctx, b, i, discord.InteractionCallbackData{
		Embeds: []discord.Embed{{
			Title:       "✅  Đăng ký thành công",
			Description: "Chào mừng chiến binh mới! Dùng `/schedule` để xem lịch thi đấu.",
			Color:       0x57F287,
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
		}},
	})
}
