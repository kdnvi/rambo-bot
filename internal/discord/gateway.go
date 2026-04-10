package discord

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

const gatewayURL = "wss://gateway.discord.gg/?v=10&encoding=json"

// GatewayIntents for the bot — Guilds, GuildMembers, GuildMessages, MessageContent.
const GatewayIntents = (1 << 0) | (1 << 1) | (1 << 9) | (1 << 15)

// EventHandler is a function called when a named dispatch event arrives.
type EventHandler func(data []byte)

// Gateway manages the Discord Gateway WebSocket connection.
type Gateway struct {
	token    string
	handlers map[string][]EventHandler

	conn      *websocket.Conn
	connMu    sync.Mutex
	sequence  atomic.Int64
	sessionID string
	resumeURL string

	heartbeatInterval time.Duration
	lastAck           atomic.Int64
}

// NewGateway creates a Gateway with the given bot token.
func NewGateway(token string) *Gateway {
	return &Gateway{
		token:    token,
		handlers: make(map[string][]EventHandler),
	}
}

// On registers a handler for a named dispatch event (e.g. "INTERACTION_CREATE").
func (g *Gateway) On(event string, fn EventHandler) {
	g.handlers[event] = append(g.handlers[event], fn)
}

// Connect opens the WebSocket connection and blocks, reconnecting on errors,
// until ctx is cancelled.
func (g *Gateway) Connect(ctx context.Context) error {
	for {
		if err := g.run(ctx); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			slog.Error("gateway disconnected, reconnecting", "err", err)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(5 * time.Second):
			}
			continue
		}
		return nil
	}
}

func (g *Gateway) run(ctx context.Context) error {
	url := gatewayURL
	if g.resumeURL != "" {
		url = g.resumeURL + "?v=10&encoding=json"
	}

	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		return fmt.Errorf("websocket dial: %w", err)
	}
	g.connMu.Lock()
	g.conn = conn
	g.connMu.Unlock()
	defer conn.CloseNow()

	// Read Hello
	var raw map[string]json.RawMessage
	if err := wsjson.Read(ctx, conn, &raw); err != nil {
		return fmt.Errorf("read hello: %w", err)
	}
	var hello HelloData
	if err := json.Unmarshal(raw["d"], &hello); err != nil {
		return fmt.Errorf("parse hello: %w", err)
	}
	g.heartbeatInterval = time.Duration(hello.HeartbeatInterval) * time.Millisecond

	// Send Identify or Resume
	if g.sessionID != "" {
		if err := g.sendResume(ctx); err != nil {
			g.sessionID = ""
			if err2 := g.sendIdentify(ctx); err2 != nil {
				return fmt.Errorf("identify after failed resume: %w", err2)
			}
		}
	} else {
		if err := g.sendIdentify(ctx); err != nil {
			return fmt.Errorf("identify: %w", err)
		}
	}

	// Start heartbeat loop
	hbCtx, hbCancel := context.WithCancel(ctx)
	defer hbCancel()
	go g.heartbeatLoop(hbCtx, conn)

	// Event read loop
	for {
		var envelope struct {
			Op       int             `json:"op"`
			Sequence *int64          `json:"s,omitempty"`
			Type     string          `json:"t,omitempty"`
			Data     json.RawMessage `json:"d"`
		}
		if err := wsjson.Read(ctx, conn, &envelope); err != nil {
			return fmt.Errorf("read: %w", err)
		}

		if envelope.Sequence != nil {
			g.sequence.Store(*envelope.Sequence)
		}

		switch envelope.Op {
		case OpcodeDispatch:
			g.dispatch(envelope.Type, []byte(envelope.Data))
		case OpcodeHeartbeat:
			_ = g.sendHeartbeat(ctx)
		case OpcodeHeartbeatAck:
			g.lastAck.Store(time.Now().UnixMilli())
		case OpcodeReconnect:
			return fmt.Errorf("server requested reconnect")
		case OpcodeInvalidSession:
			// Non-resumable invalid session
			g.sessionID = ""
			g.resumeURL = ""
			return fmt.Errorf("invalid session")
		}
	}
}

func (g *Gateway) dispatch(event string, data []byte) {
	if event == "READY" {
		var ready ReadyData
		if err := json.Unmarshal(data, &ready); err == nil {
			g.sessionID = ready.SessionID
			g.resumeURL = ready.ResumeGatewayURL
		}
	}
	for _, h := range g.handlers[event] {
		go h(data)
	}
}

func (g *Gateway) heartbeatLoop(ctx context.Context, conn *websocket.Conn) {
	// Jitter: start at a random fraction of the interval per Discord spec
	ticker := time.NewTicker(g.heartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := g.sendHeartbeat(ctx); err != nil {
				slog.Error("heartbeat send failed", "err", err)
				return
			}
		}
	}
}

func (g *Gateway) sendHeartbeat(ctx context.Context) error {
	seq := g.sequence.Load()
	payload := map[string]interface{}{"op": OpcodeHeartbeat, "d": seq}
	g.connMu.Lock()
	defer g.connMu.Unlock()
	return wsjson.Write(ctx, g.conn, payload)
}

func (g *Gateway) sendIdentify(ctx context.Context) error {
	payload := map[string]interface{}{
		"op": OpcodeIdentify,
		"d": IdentifyData{
			Token:   g.token,
			Intents: GatewayIntents,
			Properties: IdentifyProperties{
				OS:      "linux",
				Browser: "rambo-bot",
				Device:  "rambo-bot",
			},
		},
	}
	g.connMu.Lock()
	defer g.connMu.Unlock()
	return wsjson.Write(ctx, g.conn, payload)
}

func (g *Gateway) sendResume(ctx context.Context) error {
	seq := g.sequence.Load()
	payload := map[string]interface{}{
		"op": OpcodeResume,
		"d": map[string]interface{}{
			"token":      g.token,
			"session_id": g.sessionID,
			"seq":        seq,
		},
	}
	g.connMu.Lock()
	defer g.connMu.Unlock()
	return wsjson.Write(ctx, g.conn, payload)
}
