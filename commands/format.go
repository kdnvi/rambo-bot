package commands

import (
	"fmt"
	"strings"

	badgespkg "github.com/kdnvi/rambo-bot/internal/badges"
	"github.com/kdnvi/rambo-bot/internal/firebase"
)

// joinLines joins strings with the given separator.
func joinLines(lines []string, sep string) string {
	return strings.Join(lines, sep)
}

// fmtVND formats points as Vietnamese Dong (pts * 1000).
func fmtVND(pts float64) string {
	vnd := int64(pts * 1000)
	// Simple VND formatter: group digits with dots
	s := fmt.Sprintf("%d", abs64(vnd))
	var out []byte
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, byte(c))
	}
	result := string(out) + "\u00a0₫"
	if vnd < 0 {
		result = "-" + result
	}
	return result
}

func abs64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

// formatBadges returns emoji icons for a player's badges.
func formatBadges(storedBadges map[string]*firebase.Badge) string {
	return badgespkg.FormatBadges(storedBadges)
}

// formatBadgesDetailed returns detailed badge descriptions for a player.
func formatBadgesDetailed(storedBadges map[string]*firebase.Badge) string {
	return badgespkg.FormatBadgesDetailed(storedBadges)
}
