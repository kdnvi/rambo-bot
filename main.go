package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/discord"
	"github.com/kdnvi/rambo-bot/internal/notify"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	b, err := bot.New(context.Background())
	if err != nil {
		slog.Error("failed to initialise bot", "err", err)
		os.Exit(1)
	}

	// Register all commands and handlers (populated in later stages).
	registerAll(b)

	// Notify dev channel that the bot is starting.
	notify.Dev(context.Background(), b.REST, b.AppID, os.Getenv("DEV_CHANNEL_ID"), "start")

	// Perform initial user sync.
	b.SyncUsers(context.Background())

	// Start background jobs.
	startJobs(ctx, b)

	// Connect to the Gateway — blocks until ctx is cancelled.
	gw := discord.NewGateway(bot.Token())
	gw.On("INTERACTION_CREATE", b.HandleInteractionCreate)
	gw.On("MESSAGE_CREATE", b.HandleMessageCreate)
	gw.On("READY", func(_ []byte) {
		slog.Info("gateway ready")
	})

	if err := gw.Connect(ctx); err != nil && err != context.Canceled {
		slog.Error("gateway exited with error", "err", err)
	}

	// Graceful shutdown — send stop notification with a short deadline.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	notify.Dev(shutdownCtx, b.REST, b.AppID, os.Getenv("DEV_CHANNEL_ID"), "stop")
	slog.Info("bot stopped")
}
