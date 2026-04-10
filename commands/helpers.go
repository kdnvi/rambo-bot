// Package commands contains all slash command handlers.
// Each handler follows the signature: func(ctx, bot, interaction).
package commands

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/discord"
	"github.com/kdnvi/rambo-bot/internal/firebase"
)

// reply sends an ephemeral or public interaction response.
func reply(ctx context.Context, b *bot.Bot, i *discord.Interaction, data discord.InteractionCallbackData) {
	resp := discord.InteractionResponse{Type: discord.CallbackChannelMessage, Data: &data}
	if err := b.REST.RespondToInteraction(ctx, i.ID, i.Token, resp); err != nil {
		slog.Error("reply failed", "err", err)
	}
}

// replyEphemeral sends an ephemeral reply.
func replyEphemeral(ctx context.Context, b *bot.Bot, i *discord.Interaction, data discord.InteractionCallbackData) {
	data.Flags = discord.MessageFlagEphemeral
	reply(ctx, b, i, data)
}

// replyErr sends a short ephemeral error message.
func replyErr(ctx context.Context, b *bot.Bot, i *discord.Interaction, msg string) {
	replyEphemeral(ctx, b, i, discord.InteractionCallbackData{Content: msg})
}

// deferReply sends a deferred response (shows "Bot is thinking…").
func deferReply(ctx context.Context, b *bot.Bot, i *discord.Interaction, ephemeral bool) error {
	flags := 0
	if ephemeral {
		flags = discord.MessageFlagEphemeral
	}
	resp := discord.InteractionResponse{
		Type: discord.CallbackDeferredChannelMessage,
		Data: &discord.InteractionCallbackData{Flags: flags},
	}
	return b.REST.RespondToInteraction(ctx, i.ID, i.Token, resp)
}

// editReply edits the deferred reply.
func editReply(ctx context.Context, b *bot.Bot, i *discord.Interaction, data discord.EditMessagePayload) {
	if _, err := b.REST.EditOriginalInteractionResponse(ctx, b.AppID, i.Token, data); err != nil {
		slog.Error("editReply failed", "err", err)
	}
}

// followup sends a followup message after the initial response.
func followup(ctx context.Context, b *bot.Bot, i *discord.Interaction, payload discord.SendMessagePayload) {
	if _, err := b.REST.FollowupMessage(ctx, b.AppID, i.Token, payload); err != nil {
		slog.Error("followup failed", "err", err)
	}
}

// WithRecover wraps a command handler so panics/errors are caught and reported.
func WithRecover(h bot.CommandHandler) bot.CommandHandler {
	return func(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("command panicked", "command", i.Data.Name, "panic", r)
				replyErr(ctx, b, i, "❌ Có lỗi xảy ra.")
			}
		}()
		h(ctx, b, i)
	}
}

// getTournamentName returns the tournament name from config or a default.
func getTournamentName(ctx context.Context, b *bot.Bot) string {
	cfg, err := b.DB.ReadTournamentConfig(ctx)
	if err != nil || cfg == nil {
		return "Tournament"
	}
	if cfg.Name == "" {
		return "Tournament"
	}
	return cfg.Name
}

// getChannelID returns the football channel ID from config or env fallback.
func getChannelID(ctx context.Context, b *bot.Bot) string {
	cfg, err := b.DB.ReadTournamentConfig(ctx)
	if err == nil && cfg != nil && cfg.ChannelID != "" {
		return cfg.ChannelID
	}
	return mustEnv("FOOTBALL_CHANNEL_ID")
}

// nowTS returns the current Unix timestamp as a string for Discord timestamps.
func nowTS() string {
	return fmt.Sprintf("%d", time.Now().Unix())
}

// unixTS parses a date string and returns its Unix timestamp.
func unixTS(dateStr string) int64 {
	t, err := time.Parse(time.RFC3339, dateStr)
	if err != nil {
		t, err = time.Parse("2006-01-02T15:04:05Z", dateStr)
	}
	if err != nil {
		return 0
	}
	return t.Unix()
}

// getWinner returns the winning team name, "draw", or "" if no result.
func getWinner(m *firebase.Match) string {
	if m.Result == nil {
		return ""
	}
	if m.Result.Home > m.Result.Away {
		return m.Home
	}
	if m.Result.Away > m.Result.Home {
		return m.Away
	}
	return "draw"
}

// findNextMatch returns the earliest upcoming unfinished match.
func findNextMatch(matches []firebase.Match) *firebase.Match {
	now := time.Now()
	var best *firebase.Match
	for idx := range matches {
		m := &matches[idx]
		if m.HasResult {
			continue
		}
		t, err := time.Parse(time.RFC3339, m.Date)
		if err != nil {
			continue
		}
		if t.Before(now) {
			continue
		}
		if best == nil {
			best = m
			continue
		}
		bt, _ := time.Parse(time.RFC3339, best.Date)
		if t.Before(bt) {
			best = m
		}
	}
	return best
}

// getMatchVote looks up a single user's vote for a match from the all-votes map.
func getMatchVote(votes map[string]map[string]map[string]*firebase.Vote, matchIndex, messageID, userID string) string {
	byMsg, ok := votes[matchIndex]
	if !ok {
		return ""
	}
	byUser, ok := byMsg[messageID]
	if !ok {
		return ""
	}
	v, ok := byUser[userID]
	if !ok || v == nil {
		return ""
	}
	return v.Vote
}

// getMatchVotes returns all votes for a specific match message.
func getMatchVotes(votes map[string]map[string]map[string]*firebase.Vote, matchIndex, messageID string) map[string]*firebase.Vote {
	byMsg, ok := votes[matchIndex]
	if !ok {
		return nil
	}
	return byMsg[messageID]
}

// upper is strings.ToUpper shorthand.
func upper(s string) string { return strings.ToUpper(s) }

// mustEnv reads an env var — bot.go validates these at startup so this is safe.
func mustEnv(key string) string {
	return os.Getenv(key)
}

// updatePollEmbed refreshes the poll message embed with the latest vote counts.
// Implemented fully in interaction.go; declared here to avoid forward-reference issues.
var updatePollEmbed = func(ctx context.Context, b *bot.Bot, matchID int, messageID string) {}
