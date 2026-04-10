package discord

// Gateway opcodes.
const (
	OpcodeDispatch       = 0
	OpcodeHeartbeat      = 1
	OpcodeIdentify       = 2
	OpcodeResume         = 6
	OpcodeReconnect      = 7
	OpcodeInvalidSession = 9
	OpcodeHello          = 10
	OpcodeHeartbeatAck   = 11
)

// Interaction types.
const (
	InteractionTypePing               = 1
	InteractionTypeApplicationCommand = 2
	InteractionTypeMessageComponent   = 3
)

// Interaction callback types.
const (
	CallbackPong                   = 1
	CallbackChannelMessage         = 4
	CallbackDeferredChannelMessage = 5
	CallbackDeferredMessageUpdate  = 6
	CallbackUpdateMessage          = 7
)

// Component types.
const (
	ComponentActionRow = 1
	ComponentButton    = 2
)

// Button styles.
const (
	ButtonPrimary   = 1
	ButtonSecondary = 2
	ButtonSuccess   = 3
	ButtonDanger    = 4
	ButtonLink      = 5
)

// MessageFlagEphemeral makes a response only visible to the invoking user.
const MessageFlagEphemeral = 1 << 6

// Command option types.
const (
	OptionString  = 3
	OptionInteger = 4
	OptionBoolean = 5
	OptionUser    = 6
)

// GatewayPayload is the raw envelope for every Gateway WebSocket message.
// Data is kept as raw JSON so callers can unmarshal into the concrete type they need.
type GatewayPayload struct {
	Op       int    `json:"op"`
	Sequence *int64 `json:"s,omitempty"`
	Type     string `json:"t,omitempty"`
	Data     []byte `json:"-"`
}

// HelloData is the d field of opcode 10 Hello.
type HelloData struct {
	HeartbeatInterval int `json:"heartbeat_interval"`
}

// IdentifyData is the d field of opcode 2 Identify.
type IdentifyData struct {
	Token      string             `json:"token"`
	Intents    int                `json:"intents"`
	Properties IdentifyProperties `json:"properties"`
}

// IdentifyProperties describes the connecting client.
type IdentifyProperties struct {
	OS      string `json:"os"`
	Browser string `json:"browser"`
	Device  string `json:"device"`
}

// ReadyData is the d field of the READY dispatch event.
type ReadyData struct {
	SessionID        string `json:"session_id"`
	ResumeGatewayURL string `json:"resume_gateway_url"`
}

// Interaction represents a Discord interaction (slash command or component).
type Interaction struct {
	ID      string          `json:"id"`
	Type    int             `json:"type"`
	Data    InteractionData `json:"data"`
	GuildID string          `json:"guild_id"`
	Token   string          `json:"token"`
	Member  *GuildMember    `json:"member,omitempty"`
	User    *User           `json:"user,omitempty"`
	Message *Message        `json:"message,omitempty"`
}

// ActingUser returns the user who triggered the interaction.
func (i *Interaction) ActingUser() *User {
	if i.Member != nil && i.Member.User != nil {
		return i.Member.User
	}
	return i.User
}

// InteractionData holds slash-command or component payload data.
type InteractionData struct {
	ID       string              `json:"id"`
	Name     string              `json:"name"`
	CustomID string              `json:"custom_id"`
	Options  []InteractionOption `json:"options,omitempty"`
}

// GetOption returns the option with the given name, or nil if not found.
func (d *InteractionData) GetOption(name string) *InteractionOption {
	for i := range d.Options {
		if d.Options[i].Name == name {
			return &d.Options[i]
		}
	}
	return nil
}

// InteractionOption is a single resolved slash-command option.
type InteractionOption struct {
	Name  string      `json:"name"`
	Type  int         `json:"type"`
	Value interface{} `json:"value"`
}

// String returns the option value as a string.
func (o *InteractionOption) String() string {
	s, _ := o.Value.(string)
	return s
}

// Int returns the option value as int64.
func (o *InteractionOption) Int() int64 {
	switch v := o.Value.(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	}
	return 0
}

// InteractionResponse is sent back to Discord to acknowledge an interaction.
type InteractionResponse struct {
	Type int                      `json:"type"`
	Data *InteractionCallbackData `json:"data,omitempty"`
}

// InteractionCallbackData is the message payload inside an interaction response.
type InteractionCallbackData struct {
	Content    string      `json:"content,omitempty"`
	Embeds     []Embed     `json:"embeds,omitempty"`
	Components []Component `json:"components,omitempty"`
	Flags      int         `json:"flags,omitempty"`
}

// Embed represents a Discord embed object.
type Embed struct {
	Title       string       `json:"title,omitempty"`
	Description string       `json:"description,omitempty"`
	Color       int          `json:"color,omitempty"`
	Fields      []EmbedField `json:"fields,omitempty"`
	Footer      *EmbedFooter `json:"footer,omitempty"`
	Thumbnail   *EmbedImage  `json:"thumbnail,omitempty"`
	Timestamp   string       `json:"timestamp,omitempty"`
}

// EmbedField is a single named field inside an embed.
type EmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

// EmbedFooter is the footer section of an embed.
type EmbedFooter struct {
	Text string `json:"text"`
}

// EmbedImage is used for thumbnail or image inside an embed.
type EmbedImage struct {
	URL string `json:"url"`
}

// Component represents an action row or a button.
type Component struct {
	Type       int         `json:"type"`
	Components []Component `json:"components,omitempty"`
	CustomID   string      `json:"custom_id,omitempty"`
	Label      string      `json:"label,omitempty"`
	Style      int         `json:"style,omitempty"`
	Disabled   bool        `json:"disabled,omitempty"`
}

// ActionRow wraps buttons into an action row component.
func ActionRow(buttons ...Component) Component {
	return Component{Type: ComponentActionRow, Components: buttons}
}

// NewButton creates a button component.
func NewButton(customID, label string, style int) Component {
	return Component{Type: ComponentButton, CustomID: customID, Label: label, Style: style}
}

// Message represents a Discord channel message.
type Message struct {
	ID        string            `json:"id"`
	ChannelID string            `json:"channel_id"`
	Content   string            `json:"content"`
	Embeds    []Embed           `json:"embeds,omitempty"`
	Author    *User             `json:"author,omitempty"`
	Reference *MessageReference `json:"message_reference,omitempty"`
	Mentions  []User            `json:"mentions,omitempty"`
}

// MessageReference points to the message being replied to.
type MessageReference struct {
	MessageID string `json:"message_id"`
	ChannelID string `json:"channel_id,omitempty"`
	GuildID   string `json:"guild_id,omitempty"`
}

// User represents a Discord user account.
type User struct {
	ID         string `json:"id"`
	Username   string `json:"username"`
	GlobalName string `json:"global_name,omitempty"`
	Avatar     string `json:"avatar,omitempty"`
	Bot        bool   `json:"bot,omitempty"`
}

// AvatarURL returns the CDN URL for the user's avatar.
func (u *User) AvatarURL() string {
	if u == nil || u.Avatar == "" {
		return ""
	}
	return "https://cdn.discordapp.com/avatars/" + u.ID + "/" + u.Avatar + ".png"
}

// DisplayName returns global name if set, otherwise username.
func (u *User) DisplayName() string {
	if u.GlobalName != "" {
		return u.GlobalName
	}
	return u.Username
}

// GuildMember represents a member of a Discord guild.
type GuildMember struct {
	User     *User  `json:"user,omitempty"`
	Nickname string `json:"nick,omitempty"`
}

// SendMessagePayload is the request body for POST /channels/{id}/messages.
type SendMessagePayload struct {
	Content    string      `json:"content,omitempty"`
	Embeds     []Embed     `json:"embeds,omitempty"`
	Components []Component `json:"components,omitempty"`
}

// EditMessagePayload is the request body for PATCH /channels/{id}/messages/{id}.
type EditMessagePayload struct {
	Content    string      `json:"content,omitempty"`
	Embeds     []Embed     `json:"embeds,omitempty"`
	Components []Component `json:"components,omitempty"`
}

// CommandOption describes a single option on a slash command.
type CommandOption struct {
	Type        int      `json:"type"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Required    bool     `json:"required,omitempty"`
	MinValue    *float64 `json:"min_value,omitempty"`
	MaxValue    *float64 `json:"max_value,omitempty"`
}

// CommandDefinition is the registration payload for a slash command.
type CommandDefinition struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Options     []CommandOption `json:"options,omitempty"`
}

// CachedUser holds resolved Discord profile data for a guild member.
type CachedUser struct {
	ID         string
	Username   string
	GlobalName string
	Nickname   string
	AvatarURL  string
}

// DisplayName returns the best available display name.
func (u *CachedUser) DisplayName() string {
	if u.Nickname != "" {
		return u.Nickname
	}
	if u.GlobalName != "" {
		return u.GlobalName
	}
	return u.Username
}
