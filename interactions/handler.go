package interactions

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/commands"
	"github.com/kdnvi/rambo-bot/internal/discord"
	"github.com/kdnvi/rambo-bot/internal/firebase"
	"github.com/kdnvi/rambo-bot/internal/flavor"
	"github.com/kdnvi/rambo-bot/internal/football"
)

const lastSecThreshold = 5 * time.Minute

// HandleComponent is the main component (button) interaction dispatcher.
// It should be registered via b.SetComponentHandler in main.
func HandleComponent(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	customID := i.Data.CustomID

	// Vote buttons have the format: "<matchID>|<outcome>"
	// Confirm/cancel from random command have: "random-confirm|...", "random-cancel"
	switch {
	case strings.HasPrefix(customID, "random-confirm|") || customID == "random-cancel":
		handleRandomConfirmCancel(ctx, b, i)
	default:
		// Treat as a vote
		handleVote(ctx, b, i)
	}
}

func handleVote(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	parts := strings.SplitN(i.Data.CustomID, "|", 2)
	if len(parts) != 2 {
		slog.Warn("unexpected vote customID", "id", i.Data.CustomID)
		return
	}
	matchIDStr := parts[0]
	teamID := parts[1]

	var matchID int
	if _, err := fmt.Sscanf(matchIDStr, "%d", &matchID); err != nil {
		slog.Warn("non-integer matchID in vote", "raw", matchIDStr)
		return
	}

	userID := ""
	if i.ActingUser() != nil {
		userID = i.ActingUser().ID
	}
	if userID == "" {
		return
	}

	// Defer the component update first (JS does deferUpdate immediately)
	if err := b.REST.RespondToInteraction(ctx, i.ID, i.Token, discord.InteractionResponse{
		Type: discord.CallbackDeferredMessageUpdate,
	}); err != nil {
		slog.Error("ack vote interaction failed", "err", err)
	}

	// Load match and players concurrently
	matchesCh := make(chan []firebase.Match, 1)
	playersCh := make(chan map[string]*firebase.Player, 1)
	go func() { m, _ := b.DB.ReadMatches(ctx); matchesCh <- m }()
	go func() { p, _ := b.DB.ReadPlayers(ctx); playersCh <- p }()
	allMatches := <-matchesCh
	players := <-playersCh

	var match *firebase.Match
	for idx := range allMatches {
		if allMatches[idx].ID == matchID {
			match = &allMatches[idx]
			break
		}
	}

	// Kickoff check: refuse votes after kickoff (JS: Date.parse(match.date) < Date.now())
	if match == nil {
		followupEphemeralEmbed(ctx, b, i, discord.Embed{
			Description: "⏰ Bóng lăn rồi — hết giờ vote!",
			Color:       0xFEE75C,
		})
		return
	}
	kickoff, _ := time.Parse(time.RFC3339, match.Date)
	if kickoff.Before(time.Now()) {
		followupEphemeralEmbed(ctx, b, i, discord.Embed{
			Description: "⏰ Bóng lăn rồi — hết giờ vote!",
			Color:       0xFEE75C,
		})
		return
	}

	if players == nil || players[userID] == nil {
		followupEphemeralEmbed(ctx, b, i, discord.Embed{
			Description: "❌ `/register` đi rồi mới vote được nha.",
			Color:       0xED4245,
		})
		return
	}

	msgID := ""
	if i.Message != nil {
		msgID = i.Message.ID
	}

	if err := b.DB.UpdateMatchVote(ctx, matchID, userID, teamID, msgID); err != nil {
		slog.Error("update vote failed", "err", err, "match", matchID, "user", userID)
		_, _ = b.REST.FollowupMessage(ctx, b.AppID, i.Token, discord.SendMessagePayload{
			Content: "❌ Có lỗi xảy ra với vote của bạn.",
			Flags:   discord.MessageFlagEphemeral,
		})
		return
	}

	// If user had random wager, remove it
	userWagers, _ := b.DB.ReadUserWagers(ctx, userID)
	hadRandom := userWagers[fmt.Sprintf("%d", matchID)] != nil && userWagers[fmt.Sprintf("%d", matchID)].Random
	if hadRandom {
		_ = b.DB.RemovePlayerWager(ctx, userID, matchID, "random")
	}

	// Update poll embed
	if err := updatePollEmbed(ctx, b, match, matchID, players); err != nil {
		slog.Warn("update poll embed failed", "err", err)
	}

	// Simple ephemeral confirmation (JS: ✅ Vote của bạn: TEAM)
	followupEphemeralEmbed(ctx, b, i, discord.Embed{
		Description: fmt.Sprintf("✅ Vote của bạn: **%s**", strings.ToUpper(teamID)),
		Color:       0x57F287,
	})

	// If had random, announce random cancellation to channel
	if hadRandom {
		channelID := getChannelID(ctx, b)
		if channelID != "" {
			cancelEmbed := discord.Embed{
				Description: fmt.Sprintf("🎲❌ **<@%s>** đã vote — random bị huỷ.", userID),
				Color:       0xFEE75C,
			}
			_, _ = b.REST.SendMessage(ctx, channelID, discord.SendMessagePayload{Embeds: []discord.Embed{cancelEmbed}})
		}
	}

	// Track vote changes and send drunk/last-sec flavor to channel
	changeCount, err := b.DB.IncrementVoteChange(ctx, matchID, userID)
	if err != nil {
		slog.Error("increment vote change failed", "err", err)
	}

	minsUntilKickoff := time.Until(kickoff).Minutes()
	needsChannel := changeCount >= 3 || (minsUntilKickoff <= 5 && minsUntilKickoff > 0)

	if needsChannel {
		channelID := getChannelID(ctx, b)
		if channelID != "" {
			if changeCount >= 3 {
				drunkLine := flavor.PickLine(ctx, b.DB, "drunk")
				drunkEmbed := discord.Embed{
					Description: fmt.Sprintf("🍺 **<@%s>** %s *(%d lần đổi vote trận #%d)*", userID, drunkLine, changeCount, matchID),
					Color:       0xE67E22,
				}
				_, _ = b.REST.SendMessage(ctx, channelID, discord.SendMessagePayload{Embeds: []discord.Embed{drunkEmbed}})
			}
			if minsUntilKickoff <= 5 && minsUntilKickoff > 0 {
				lastSecLine := flavor.PickLine(ctx, b.DB, "last_sec")
				lateEmbed := discord.Embed{
					Description: fmt.Sprintf("⏰ **<@%s>** %s *(trận #%d)*", userID, lastSecLine, matchID),
					Color:       0xFEE75C,
				}
				_, _ = b.REST.SendMessage(ctx, channelID, discord.SendMessagePayload{Embeds: []discord.Embed{lateEmbed}})
			}
		}
	}

	slog.Info("vote recorded", "match", matchID, "user", userID, "pick", teamID, "changes", changeCount)
}

func followupEphemeralEmbed(ctx context.Context, b *bot.Bot, i *discord.Interaction, embed discord.Embed) {
	_, _ = b.REST.FollowupMessage(ctx, b.AppID, i.Token, discord.SendMessagePayload{
		Embeds: []discord.Embed{embed},
		Flags:  discord.MessageFlagEphemeral,
	})
}

func getChannelID(ctx context.Context, b *bot.Bot) string {
	cfg, err := b.DB.ReadTournamentConfig(ctx)
	if err == nil && cfg != nil && cfg.ChannelID != "" {
		return cfg.ChannelID
	}
	return ""
}

func updatePollEmbed(ctx context.Context, b *bot.Bot, match *firebase.Match, matchID int, players map[string]*firebase.Player) error {
	if match.MessageID == "" {
		return nil
	}

	channelID := match.ChannelID
	if channelID == "" {
		cfg, err := b.DB.ReadTournamentConfig(ctx)
		if err == nil && cfg != nil && cfg.ChannelID != "" {
			channelID = cfg.ChannelID
		}
	}
	if channelID == "" {
		return fmt.Errorf("no channel ID")
	}

	votes, err := b.DB.ReadMatchVotes(ctx, matchID, match.MessageID)
	if err != nil {
		return err
	}

	users := b.GetAllCachedUsers()
	outcomes := []string{match.Home, "draw", match.Away}
	tally := map[string][]string{}
	for _, o := range outcomes {
		tally[o] = []string{}
	}
	for uid, v := range votes {
		if v == nil {
			continue
		}
		o := v.Vote
		if _, ok := tally[o]; !ok {
			tally[o] = []string{}
		}
		name := "?"
		if u := users[uid]; u != nil {
			name = u.DisplayName()
		}
		tally[o] = append(tally[o], name)
	}

	total := len(votes)
	lines := make([]string, 0, 4)
	icons := map[string]string{match.Home: "🟢", "draw": "🟡", match.Away: "🔴"}
	for _, o := range outcomes {
		icon := icons[o]
		pickers := tally[o]
		pct := 0
		if total > 0 {
			pct = len(pickers) * 100 / total
		}
		bar := progressBar(pct)
		names := "—"
		if len(pickers) > 0 {
			names = strings.Join(pickers, ", ")
		}
		lines = append(lines, fmt.Sprintf("%s **%s** %s %d%% (%d)\n┗ %s", icon, strings.ToUpper(o), bar, pct, len(pickers), names))
	}

	stake := football.GetMatchStake(matchID)
	kickoff, _ := time.Parse(time.RFC3339, match.Date)
	ts := kickoff.Unix()
	embed := discord.Embed{
		Title:       fmt.Sprintf("⚽  %s  vs  %s", strings.ToUpper(match.Home), strings.ToUpper(match.Away)),
		Description: strings.Join(lines, "\n\n"),
		Color:       0x5865F2,
		Fields: []discord.EmbedField{
			{Name: "🕐 Kickoff", Value: fmt.Sprintf("<t:%d:F>", ts), Inline: true},
			{Name: "💰 Cược", Value: fmt.Sprintf("%d pts", stake), Inline: true},
			{Name: "👥 Đã vote", Value: fmt.Sprintf("%d/%d", total, len(players)), Inline: true},
		},
		Footer:    &discord.EmbedFooter{Text: "Cập nhật lần cuối"},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	row := discord.ActionRow(
		discord.NewButton(fmt.Sprintf("%d|%s", matchID, match.Home), strings.ToUpper(match.Home), discord.ButtonSuccess),
		discord.NewButton(fmt.Sprintf("%d|draw", matchID), "DRAW", discord.ButtonPrimary),
		discord.NewButton(fmt.Sprintf("%d|%s", matchID, match.Away), strings.ToUpper(match.Away), discord.ButtonDanger),
	)

	_, err = b.REST.EditMessage(ctx, channelID, match.MessageID, discord.EditMessagePayload{
		Embeds:     []discord.Embed{embed},
		Components: []discord.Component{row},
	})
	return err
}

func progressBar(pct int) string {
	filled := pct / 10
	if filled > 10 {
		filled = 10
	}
	bar := strings.Repeat("█", filled) + strings.Repeat("░", 10-filled)
	return bar
}

func handleRandomConfirmCancel(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	commands.HandleRandomButton(ctx, b, i)
}

func respondEphemeral(ctx context.Context, b *bot.Bot, i *discord.Interaction, msg string) {
	_ = b.REST.RespondToInteraction(ctx, i.ID, i.Token, discord.InteractionResponse{
		Type: discord.CallbackChannelMessage,
		Data: &discord.InteractionCallbackData{
			Content: msg,
			Flags:   discord.MessageFlagEphemeral,
		},
	})
}
