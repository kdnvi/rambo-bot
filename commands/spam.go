package commands

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/discord"
)

func Spam(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	allowed := map[string]bool{}
	for _, id := range strings.Split(os.Getenv("AUDITED_USERS"), ",") {
		if id != "" {
			allowed[id] = true
		}
	}
	if !allowed[i.ActingUser().ID] {
		replyErr(ctx, b, i, "❌ Bạn không có quyền xài lệnh này.")
		return
	}

	opt := i.Data.GetOption("user")
	if opt == nil {
		replyErr(ctx, b, i, "❌ Thiếu user.")
		return
	}
	targetID := opt.String()
	mention := fmt.Sprintf("<@%s>", targetID)

	invokerName := i.ActingUser().DisplayName()
	if u := b.GetCachedUser(i.ActingUser().ID); u != nil {
		invokerName = u.DisplayName()
	}

	targetAvatarURL := ""
	if u := b.GetCachedUser(targetID); u != nil {
		targetAvatarURL = u.AvatarURL
	}

	embed := discord.Embed{
		Title:       "📢  CHÚ Ý",
		Description: strings.Repeat(mention+" ", 20),
		Color:       0xED4245,
		Footer:      &discord.EmbedFooter{Text: invokerName + " triệu hồi"},
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}
	if targetAvatarURL != "" {
		embed.Thumbnail = &discord.EmbedImage{URL: targetAvatarURL}
	}

	reply(ctx, b, i, discord.InteractionCallbackData{Embeds: []discord.Embed{embed}})
}
