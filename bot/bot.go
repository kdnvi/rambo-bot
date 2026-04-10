package bot

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"strings"
	"sync"

	"github.com/kdnvi/rambo-bot/internal/discord"
	"github.com/kdnvi/rambo-bot/internal/firebase"
)

// CommandHandler handles a slash command interaction.
type CommandHandler func(ctx context.Context, b *Bot, i *discord.Interaction)

// Bot is the central application object — holds the REST client, Firebase
// client, cached guild members, and the command/interaction dispatch tables.
type Bot struct {
	REST    *discord.REST
	DB      *firebase.Client
	AppID   string
	GuildID string

	cachedUsers   map[string]*discord.CachedUser
	cachedUsersMu sync.RWMutex

	commands    map[string]CommandHandler
	commandsMu  sync.RWMutex
}

// New creates a Bot from environment variables.
// Required: TOKEN, APP_ID, GUILD_ID, FIREBASE_DB_URL
func New(ctx context.Context) (*Bot, error) {
	token := mustEnv("TOKEN")
	appID := mustEnv("APP_ID")
	guildID := mustEnv("GUILD_ID")
	dbURL := mustEnv("FIREBASE_DB_URL")

	db, err := firebase.New(ctx, dbURL)
	if err != nil {
		return nil, err
	}

	return &Bot{
		REST:        discord.NewREST(token),
		DB:          db,
		AppID:       appID,
		GuildID:     guildID,
		cachedUsers: map[string]*discord.CachedUser{},
		commands:    map[string]CommandHandler{},
	}, nil
}

// Register adds a command handler.
func (b *Bot) Register(name string, h CommandHandler) {
	b.commandsMu.Lock()
	defer b.commandsMu.Unlock()
	b.commands[name] = h
}

// HandleInteractionCreate is the Gateway event handler for INTERACTION_CREATE.
func (b *Bot) HandleInteractionCreate(data []byte) {
	var interaction discord.Interaction
	if err := json.Unmarshal(data, &interaction); err != nil {
		slog.Error("failed to parse interaction", "err", err)
		return
	}

	ctx := context.Background()

	switch interaction.Type {
	case discord.InteractionTypeApplicationCommand:
		b.commandsMu.RLock()
		h, ok := b.commands[interaction.Data.Name]
		b.commandsMu.RUnlock()
		if !ok {
			slog.Error("unknown command", "name", interaction.Data.Name)
			return
		}
		go h(ctx, b, &interaction)

	case discord.InteractionTypeMessageComponent:
		go b.handleComponent(ctx, &interaction)
	}
}

// handleComponent is set by the commands package via SetComponentHandler.
var componentHandler func(ctx context.Context, b *Bot, i *discord.Interaction)

// SetComponentHandler registers the button/component interaction handler.
// Called from main after all commands are registered.
func (b *Bot) SetComponentHandler(h func(ctx context.Context, b *Bot, i *discord.Interaction)) {
	componentHandler = h
}

func (b *Bot) handleComponent(ctx context.Context, i *discord.Interaction) {
	if componentHandler != nil {
		componentHandler(ctx, b, i)
	}
}

// HandleMessageCreate is the Gateway event handler for MESSAGE_CREATE.
func (b *Bot) HandleMessageCreate(data []byte) {
	var msg discord.Message
	if err := json.Unmarshal(data, &msg); err != nil {
		slog.Error("failed to parse message", "err", err)
		return
	}
	if msg.Author != nil && msg.Author.Bot {
		return
	}
	ctx := context.Background()
	go b.handleMessage(ctx, &msg)
}

// messageHandler is set by SetMessageHandler.
var messageHandler func(ctx context.Context, b *Bot, msg *discord.Message)

// SetMessageHandler registers the message-create handler.
func (b *Bot) SetMessageHandler(h func(ctx context.Context, b *Bot, msg *discord.Message)) {
	messageHandler = h
}

func (b *Bot) handleMessage(ctx context.Context, msg *discord.Message) {
	if messageHandler != nil {
		messageHandler(ctx, b, msg)
	}
}

// SyncUsers fetches guild members for the audited user list and caches them.
func (b *Bot) SyncUsers(ctx context.Context) {
	userIDs := strings.Split(os.Getenv("AUDITED_USERS"), ",")
	filtered := userIDs[:0]
	for _, id := range userIDs {
		if id != "" {
			filtered = append(filtered, id)
		}
	}
	if len(filtered) == 0 {
		slog.Warn("AUDITED_USERS is empty, skipping user sync")
		return
	}

	members, err := b.REST.GetGuildMembers(ctx, b.GuildID, filtered)
	if err != nil {
		slog.Error("failed to fetch guild members", "err", err)
		return
	}

	updated := make(map[string]*discord.CachedUser, len(members))
	for _, m := range members {
		if m.User == nil {
			continue
		}
		updated[m.User.ID] = &discord.CachedUser{
			ID:         m.User.ID,
			Username:   m.User.Username,
			GlobalName: m.User.GlobalName,
			Nickname:   m.Nickname,
			AvatarURL:  m.User.AvatarURL(),
		}
	}

	b.cachedUsersMu.Lock()
	b.cachedUsers = updated
	b.cachedUsersMu.Unlock()
	slog.Info("synced discord users", "count", len(updated))
}

// GetCachedUser returns a cached user by ID.
func (b *Bot) GetCachedUser(id string) *discord.CachedUser {
	b.cachedUsersMu.RLock()
	defer b.cachedUsersMu.RUnlock()
	return b.cachedUsers[id]
}

// GetAllCachedUsers returns a snapshot of all cached users.
func (b *Bot) GetAllCachedUsers() map[string]*discord.CachedUser {
	b.cachedUsersMu.RLock()
	defer b.cachedUsersMu.RUnlock()
	out := make(map[string]*discord.CachedUser, len(b.cachedUsers))
	for k, v := range b.cachedUsers {
		out[k] = v
	}
	return out
}

// UserDisplayName returns the best display name for a user ID.
func (b *Bot) UserDisplayName(id string) string {
	if u := b.GetCachedUser(id); u != nil {
		return u.DisplayName()
	}
	return "Unknown"
}

// Token returns the bot token (read from env so REST client can be re-used).
func Token() string {
	return mustEnv("TOKEN")
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		slog.Error("missing required environment variable", "key", key)
		os.Exit(1)
	}
	return v
}
