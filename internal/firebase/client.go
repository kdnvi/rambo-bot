package firebase

import (
	"context"
	"fmt"
	"log/slog"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/db"
)

// Client wraps the Firebase Realtime Database.
type Client struct {
	db *db.Client
}

// New initialises Firebase using application default credentials.
func New(ctx context.Context, databaseURL string) (*Client, error) {
	app, err := firebase.NewApp(ctx, &firebase.Config{DatabaseURL: databaseURL})
	if err != nil {
		return nil, fmt.Errorf("firebase init: %w", err)
	}
	dbClient, err := app.Database(ctx)
	if err != nil {
		return nil, fmt.Errorf("firebase database: %w", err)
	}
	return &Client{db: dbClient}, nil
}

// ref returns a database reference for the given path.
func (c *Client) ref(path string) *db.Ref {
	return c.db.NewRef(path)
}

// --- Tournament config ---

type TournamentConfig struct {
	ChannelID  string `json:"channelId"`
	Name       string `json:"name"`
	RulesText  string `json:"rulesText,omitempty"`
}

func (c *Client) ReadTournamentConfig(ctx context.Context) (*TournamentConfig, error) {
	var cfg TournamentConfig
	if err := c.ref("tournament/config").Get(ctx, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// --- Matches ---

type MatchResult struct {
	Home int `json:"home"`
	Away int `json:"away"`
}

type Match struct {
	ID             int          `json:"id"`
	Home           string       `json:"home"`
	Away           string       `json:"away"`
	Date           string       `json:"date"`
	Location       string       `json:"location"`
	HasResult      bool         `json:"hasResult"`
	IsCalculated   bool         `json:"isCalculated"`
	Result         *MatchResult `json:"result,omitempty"`
	MessageID      string       `json:"messageId,omitempty"`
	ChannelID      string       `json:"channelId,omitempty"`
	Reminded       bool         `json:"reminded"`
	ResultReminded bool         `json:"resultReminded"`
	GroupUpdated   bool         `json:"groupUpdated"`
	MvpAnnounced   bool         `json:"mvpAnnounced"`
	RandomPicks    map[string]string `json:"randomPicks,omitempty"`
}

func (c *Client) ReadMatches(ctx context.Context) ([]Match, error) {
	var matches []Match
	if err := c.ref("tournament/matches").Get(ctx, &matches); err != nil {
		return nil, err
	}
	return matches, nil
}

func (c *Client) UpdateMatch(ctx context.Context, index int, fields map[string]interface{}) error {
	if err := c.ref(fmt.Sprintf("tournament/matches/%d", index)).Update(ctx, fields); err != nil {
		return err
	}
	slog.Info("updated match", "index", index, "fields", fmt.Sprintf("%v", fields))
	return nil
}

func (c *Client) UpdateMatchResult(ctx context.Context, index, homeScore, awayScore int) (*Match, error) {
	ref := c.ref(fmt.Sprintf("tournament/matches/%d", index))
	var match Match
	if err := ref.Get(ctx, &match); err != nil {
		return nil, err
	}
	if match.ID == 0 {
		return nil, fmt.Errorf("not_found")
	}
	if match.HasResult {
		return &match, fmt.Errorf("already_exists")
	}
	if err := ref.Update(ctx, map[string]interface{}{
		"hasResult":    true,
		"isCalculated": false,
		"result": map[string]int{
			"home": homeScore,
			"away": awayScore,
		},
	}); err != nil {
		return nil, err
	}
	slog.Info("updated match result", "index", index, "home", homeScore, "away", awayScore)
	return &match, nil
}

func (c *Client) SaveMatchRandomPicks(ctx context.Context, index int, picks map[string]string) error {
	if len(picks) == 0 {
		return nil
	}
	return c.ref(fmt.Sprintf("tournament/matches/%d/randomPicks", index)).Set(ctx, picks)
}

// --- Players ---

type Player struct {
	Points             float64 `json:"points"`
	Matches            int     `json:"matches"`
	HadNegativeBalance bool    `json:"hadNegativeBalance,omitempty"`
}

func (c *Client) ReadPlayers(ctx context.Context) (map[string]*Player, error) {
	var players map[string]*Player
	if err := c.ref("tournament/players").Get(ctx, &players); err != nil {
		return nil, err
	}
	return players, nil
}

func (c *Client) RegisterPlayer(ctx context.Context, userID string) error {
	ref := c.ref("tournament/players/" + userID)
	return ref.Transaction(ctx, func(node db.TransactionNode) (interface{}, error) {
		var existing interface{}
		if err := node.Unmarshal(&existing); err == nil && existing != nil {
			return nil, fmt.Errorf("already_registered")
		}
		return map[string]interface{}{"points": 0, "matches": 0}, nil
	})
}

func (c *Client) UpdatePlayers(ctx context.Context, players map[string]*Player) error {
	updates := make(map[string]interface{}, len(players))
	for id, p := range players {
		updates[id] = p
	}
	if err := c.ref("tournament/players").Update(ctx, updates); err != nil {
		return err
	}
	slog.Info("updated players", "count", len(players))
	return nil
}

// --- Votes ---

type Vote struct {
	Vote string `json:"vote"`
}

func (c *Client) ReadAllVotes(ctx context.Context) (map[string]map[string]map[string]*Vote, error) {
	// votes[matchIndex][messageId][userId]
	var votes map[string]map[string]map[string]*Vote
	if err := c.ref("tournament/votes").Get(ctx, &votes); err != nil {
		return nil, err
	}
	return votes, nil
}

func (c *Client) ReadMatchVotes(ctx context.Context, matchID int, messageID string) (map[string]*Vote, error) {
	var votes map[string]*Vote
	if err := c.ref(fmt.Sprintf("tournament/votes/%d/%s", matchID-1, messageID)).Get(ctx, &votes); err != nil {
		return nil, err
	}
	return votes, nil
}

func (c *Client) UpdateMatchVote(ctx context.Context, matchID int, userID, vote, messageID string) error {
	return c.ref(fmt.Sprintf("tournament/votes/%d/%s/%s", matchID-1, messageID, userID)).
		Update(ctx, map[string]interface{}{"vote": vote})
}

func (c *Client) RemoveMatchVote(ctx context.Context, matchID int, userID, messageID string) error {
	return c.ref(fmt.Sprintf("tournament/votes/%d/%s/%s", matchID-1, messageID, userID)).Delete(ctx)
}

func (c *Client) IncrementVoteChange(ctx context.Context, matchID int, userID string) (int, error) {
	ref := c.ref(fmt.Sprintf("tournament/voteChanges/%d/%s", matchID, userID))
	var result int
	err := ref.Transaction(ctx, func(node db.TransactionNode) (interface{}, error) {
		var current int
		if err := node.Unmarshal(&current); err != nil {
			current = 0
		}
		result = current + 1
		return result, nil
	})
	return result, err
}

// --- Wagers ---

type Wager struct {
	DoubleDown bool `json:"doubleDown,omitempty"`
	Random     bool `json:"random,omitempty"`
}

func (c *Client) ReadPlayerWagers(ctx context.Context) (map[string]map[string]*Wager, error) {
	var wagers map[string]map[string]*Wager
	if err := c.ref("tournament/wagers").Get(ctx, &wagers); err != nil {
		return nil, err
	}
	if wagers == nil {
		wagers = map[string]map[string]*Wager{}
	}
	return wagers, nil
}

func (c *Client) ReadUserWagers(ctx context.Context, userID string) (map[string]*Wager, error) {
	var wagers map[string]*Wager
	if err := c.ref("tournament/wagers/" + userID).Get(ctx, &wagers); err != nil {
		return nil, err
	}
	if wagers == nil {
		wagers = map[string]*Wager{}
	}
	return wagers, nil
}

func (c *Client) SetPlayerWager(ctx context.Context, userID string, matchID int, flag string) error {
	return c.ref(fmt.Sprintf("tournament/wagers/%s/%d/%s", userID, matchID, flag)).Set(ctx, true)
}

func (c *Client) RemovePlayerWager(ctx context.Context, userID string, matchID int, flag string) error {
	path := fmt.Sprintf("tournament/wagers/%s/%d", userID, matchID)
	if flag != "" {
		path += "/" + flag
	}
	return c.ref(path).Delete(ctx)
}

// --- Curses ---

type Curse struct {
	Target string `json:"target"`
}

func (c *Client) ReadCurses(ctx context.Context) (map[string]map[string]*Curse, error) {
	var curses map[string]map[string]*Curse
	if err := c.ref("tournament/curses").Get(ctx, &curses); err != nil {
		return nil, err
	}
	if curses == nil {
		curses = map[string]map[string]*Curse{}
	}
	return curses, nil
}

func (c *Client) SetCurse(ctx context.Context, curserID, targetID string, matchID int) error {
	return c.ref(fmt.Sprintf("tournament/curses/%d/%s", matchID, curserID)).
		Set(ctx, map[string]string{"target": targetID})
}

func (c *Client) RemoveCurse(ctx context.Context, curserID string, matchID int) error {
	return c.ref(fmt.Sprintf("tournament/curses/%d/%s", matchID, curserID)).Delete(ctx)
}

// --- Badges ---

type Badge struct {
	EarnedAt int64  `json:"earnedAt"`
	MatchID  int    `json:"matchId,omitempty"`
}

func (c *Client) ReadPlayerBadges(ctx context.Context, userID string) (map[string]*Badge, error) {
	var badges map[string]*Badge
	if err := c.ref("tournament/badges/" + userID).Get(ctx, &badges); err != nil {
		return nil, err
	}
	if badges == nil {
		badges = map[string]*Badge{}
	}
	return badges, nil
}

func (c *Client) ReadAllBadges(ctx context.Context) (map[string]map[string]*Badge, error) {
	var badges map[string]map[string]*Badge
	if err := c.ref("tournament/badges").Get(ctx, &badges); err != nil {
		return nil, err
	}
	if badges == nil {
		badges = map[string]map[string]*Badge{}
	}
	return badges, nil
}

func (c *Client) AwardBadge(ctx context.Context, userID, badgeID string, meta map[string]interface{}) (bool, error) {
	ref := c.ref(fmt.Sprintf("tournament/badges/%s/%s", userID, badgeID))
	var existing interface{}
	if err := ref.Get(ctx, &existing); err == nil && existing != nil {
		return false, nil
	}
	payload := map[string]interface{}{"earnedAt": nowMillis()}
	for k, v := range meta {
		payload[k] = v
	}
	if err := ref.Set(ctx, payload); err != nil {
		return false, err
	}
	slog.Info("badge awarded", "user", userID, "badge", badgeID)
	return true, nil
}

// --- Groups ---

type GroupTeamStats struct {
	Played         int `json:"played"`
	Won            int `json:"won"`
	Drawn          int `json:"drawn"`
	Lost           int `json:"lost"`
	For            int `json:"for"`
	Against        int `json:"against"`
	GoalDifference int `json:"goalDifference"`
	Points         int `json:"points"`
}

func (c *Client) ReadGroups(ctx context.Context) (map[string]map[string]*GroupTeamStats, error) {
	var groups map[string]map[string]*GroupTeamStats
	if err := c.ref("tournament/groups").Get(ctx, &groups); err != nil {
		return nil, err
	}
	return groups, nil
}

func (c *Client) UpdateGroupTeam(ctx context.Context, groupKey, teamName string, stats *GroupTeamStats) error {
	if err := c.ref(fmt.Sprintf("tournament/groups/%s/%s", groupKey, teamName)).Set(ctx, stats); err != nil {
		return err
	}
	slog.Info("updated group team", "group", groupKey, "team", teamName)
	return nil
}

// --- Flavor ---

func (c *Client) ReadFlavor(ctx context.Context) (map[string][]string, error) {
	var flavor map[string][]string
	if err := c.ref("flavor").Get(ctx, &flavor); err != nil {
		return nil, err
	}
	if flavor == nil {
		flavor = map[string][]string{}
	}
	return flavor, nil
}

// nowMillis returns current time as Unix milliseconds.
func nowMillis() int64 {
	return timeNow().UnixMilli()
}
