package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

const apiBase = "https://discord.com/api/v10"

// REST is a thin Discord REST client.
type REST struct {
	token  string
	client *http.Client
}

// NewREST creates a REST client for the given bot token.
func NewREST(token string) *REST {
	return &REST{token: token, client: &http.Client{}}
}

func (r *REST) do(ctx context.Context, method, path string, body interface{}) ([]byte, error) {
	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, apiBase+path, bodyReader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bot "+r.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("discord REST %s %s → %d: %s", method, path, resp.StatusCode, respBody)
	}
	return respBody, nil
}

// RespondToInteraction sends the initial response to an interaction.
func (r *REST) RespondToInteraction(ctx context.Context, interactionID, token string, resp InteractionResponse) error {
	_, err := r.do(ctx, http.MethodPost,
		"/interactions/"+interactionID+"/"+token+"/callback",
		resp)
	return err
}

// FollowupMessage sends a followup message for an interaction (after initial response).
func (r *REST) FollowupMessage(ctx context.Context, appID, token string, payload SendMessagePayload) (*Message, error) {
	data, err := r.do(ctx, http.MethodPost,
		"/webhooks/"+appID+"/"+token,
		payload)
	if err != nil {
		return nil, err
	}
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

// EditOriginalInteractionResponse edits the original deferred response.
func (r *REST) EditOriginalInteractionResponse(ctx context.Context, appID, token string, payload EditMessagePayload) (*Message, error) {
	data, err := r.do(ctx, http.MethodPatch,
		"/webhooks/"+appID+"/"+token+"/messages/@original",
		payload)
	if err != nil {
		return nil, err
	}
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

// SendMessage posts a message to a channel.
func (r *REST) SendMessage(ctx context.Context, channelID string, payload SendMessagePayload) (*Message, error) {
	data, err := r.do(ctx, http.MethodPost,
		"/channels/"+channelID+"/messages",
		payload)
	if err != nil {
		return nil, err
	}
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

// EditMessage edits an existing channel message.
func (r *REST) EditMessage(ctx context.Context, channelID, messageID string, payload EditMessagePayload) (*Message, error) {
	data, err := r.do(ctx, http.MethodPatch,
		"/channels/"+channelID+"/messages/"+messageID,
		payload)
	if err != nil {
		return nil, err
	}
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

// GetMessage fetches a single message from a channel.
func (r *REST) GetMessage(ctx context.Context, channelID, messageID string) (*Message, error) {
	data, err := r.do(ctx, http.MethodGet,
		"/channels/"+channelID+"/messages/"+messageID,
		nil)
	if err != nil {
		return nil, err
	}
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

// GetGuildMembers fetches up to limit members of a guild.
func (r *REST) GetGuildMembers(ctx context.Context, guildID string, userIDs []string) ([]GuildMember, error) {
	// Discord doesn't support bulk-fetch by IDs directly; fetch each individually.
	members := make([]GuildMember, 0, len(userIDs))
	for _, uid := range userIDs {
		data, err := r.do(ctx, http.MethodGet,
			"/guilds/"+guildID+"/members/"+uid,
			nil)
		if err != nil {
			return nil, fmt.Errorf("fetch member %s: %w", uid, err)
		}
		var m GuildMember
		if err := json.Unmarshal(data, &m); err != nil {
			return nil, err
		}
		members = append(members, m)
	}
	return members, nil
}

// ReplyToMessage sends a message that replies to an existing message.
func (r *REST) ReplyToMessage(ctx context.Context, channelID, referencedMessageID, content string) (*Message, error) {
	payload := struct {
		Content          string            `json:"content"`
		MessageReference *MessageReference `json:"message_reference,omitempty"`
	}{
		Content: content,
		MessageReference: &MessageReference{
			MessageID: referencedMessageID,
			ChannelID: channelID,
		},
	}
	data, err := r.do(ctx, http.MethodPost,
		"/channels/"+channelID+"/messages",
		payload)
	if err != nil {
		return nil, err
	}
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}
