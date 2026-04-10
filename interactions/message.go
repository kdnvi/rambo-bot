package interactions

import (
	"context"
	"log/slog"
	"math/rand"
	"os"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/discord"
	"github.com/kdnvi/rambo-bot/internal/flavor"
)

const botReplyChance = 0.5

// HandleMessage handles MESSAGE_CREATE events — responds to bot mentions/replies.
func HandleMessage(ctx context.Context, b *bot.Bot, msg *discord.Message) {
	botID := os.Getenv("APP_ID")
	if botID == "" {
		return
	}

	isMentioned := false
	for _, u := range msg.Mentions {
		if u.ID == botID {
			isMentioned = true
			break
		}
	}

	isReply := msg.Reference != nil && msg.Reference.MessageID != ""

	if !isMentioned && !isReply {
		return
	}

	// If replying to a message, check if it was the bot's message
	if isReply {
		repliedMsg, err := b.REST.GetMessage(ctx, msg.ChannelID, msg.Reference.MessageID)
		if err == nil && repliedMsg != nil && repliedMsg.Author != nil && repliedMsg.Author.ID == botID {
			if rand.Float64() > botReplyChance {
				return
			}
			line := flavor.PickLine(ctx, b.DB, "reply")
			if line == "" {
				return
			}
			if _, err := b.REST.ReplyToMessage(ctx, msg.ChannelID, msg.ID, line); err != nil {
				slog.Error("reply to message failed", "err", err)
			}
			return
		}
	}

	if isMentioned {
		line := flavor.PickLine(ctx, b.DB, "mention")
		if line == "" {
			return
		}
		if _, err := b.REST.ReplyToMessage(ctx, msg.ChannelID, msg.ID, line); err != nil {
			slog.Error("reply to mention failed", "err", err)
		}
	}
}
