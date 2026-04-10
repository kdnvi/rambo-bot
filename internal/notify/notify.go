package notify

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/kdnvi/rambo-bot/internal/discord"
)

var labels = map[string]string{
	"start":   "🟢 Bot started",
	"stop":    "🔴 Bot stopped",
	"restart": "🟡 Bot restarting",
}

// Dev sends a lifecycle notification to the dev channel.
func Dev(ctx context.Context, rest *discord.REST, appID, channelID, event string) {
	if channelID == "" {
		slog.Warn("DEV_CHANNEL_ID not set, skipping dev notification")
		return
	}
	label, ok := labels[event]
	if !ok {
		label = event
	}
	ts := time.Now().Unix()
	content := fmt.Sprintf("%s — <t:%d:f>", label, ts)

	if _, err := rest.SendMessage(ctx, channelID, discord.SendMessagePayload{Content: content}); err != nil {
		slog.Error("failed to send dev notification", "err", err)
		return
	}
	slog.Info("dev notification sent", "event", event)
}
