package main

import (
	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/commands"
	"github.com/kdnvi/rambo-bot/interactions"
)

// registerAll wires up all slash commands and event handlers.
func registerAll(b *bot.Bot) {
	// Read-only commands
	b.Register("schedule", commands.WithRecover(commands.Schedule))
	b.Register("match", commands.WithRecover(commands.Match))
	b.Register("rank", commands.WithRecover(commands.Rank))
	b.Register("stats", commands.WithRecover(commands.Stats))
	b.Register("history", commands.WithRecover(commands.History))
	b.Register("group", commands.WithRecover(commands.Group))
	b.Register("worldcup-playoff", commands.WithRecover(commands.Playoff))
	b.Register("rule", commands.WithRecover(commands.Rule))
	b.Register("spam", commands.WithRecover(commands.Spam))
	b.Register("wall-of-shame", commands.WithRecover(commands.WallOfShame))

	// Write commands
	b.Register("register", commands.WithRecover(commands.Register))
	b.Register("double-down", commands.WithRecover(commands.DoubleDown))
	b.Register("undo-double-down", commands.WithRecover(commands.UndoDoubleDown))
	b.Register("curse", commands.WithRecover(commands.Curse))
	b.Register("uncurse", commands.WithRecover(commands.Uncurse))
	b.Register("random", commands.WithRecover(commands.Random))

	// Admin commands
	b.Register("update-result", commands.WithRecover(commands.UpdateResult))

	// Button interaction and message handlers
	b.SetComponentHandler(interactions.HandleComponent)
	b.SetMessageHandler(interactions.HandleMessage)
}
