package main

import (
	"context"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/jobs"
)

// startJobs launches all background ticker jobs.
func startJobs(ctx context.Context, b *bot.Bot) {
	jobs.StartAll(ctx, b)
}
