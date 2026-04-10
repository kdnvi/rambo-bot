package commands

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/discord"
)

func Rule(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	cfg, err := b.DB.ReadTournamentConfig(ctx)
	tournamentName := "Tournament"
	var rulesText string
	if err == nil && cfg != nil {
		if cfg.Name != "" {
			tournamentName = cfg.Name
		}
		rulesText = cfg.RulesText
	}

	embed := discord.Embed{
		Title:     fmt.Sprintf("📋  %s — Luật chơi", tournamentName),
		Color:     0x5865F2,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	if rulesText != "" {
		desc := strings.ReplaceAll(rulesText, `\n`, "\n")
		if len(desc) > 4096 {
			desc = desc[:4093] + "..."
		}
		embed.Description = desc
		reply(ctx, b, i, discord.InteractionCallbackData{Embeds: []discord.Embed{embed}})
	} else {
		embed.Description = "Chưa có luật chơi cho giải này."
		embed.Color = 0xFEE75C
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{Embeds: []discord.Embed{embed}})
	}
}
