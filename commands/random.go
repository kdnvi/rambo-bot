package commands

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/discord"
	"github.com/kdnvi/rambo-bot/internal/firebase"
	"github.com/kdnvi/rambo-bot/internal/flavor"
)

var randomPending sync.Map
var randomConfirmPending sync.Map

func Random(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	userID := i.ActingUser().ID

	if _, loaded := randomPending.LoadOrStore(userID, struct{}{}); loaded {
		replyErr(ctx, b, i, "⏳ Đang xử lý, đợi xíu...")
		return
	}
	defer randomPending.Delete(userID)

	players, err := b.DB.ReadPlayers(ctx)
	if err != nil || players[userID] == nil {
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       "❌  Chưa đăng ký",
				Description: "Bạn cần `/register` trước.",
				Color:       0xED4245,
			}},
		})
		return
	}

	matches, err := b.DB.ReadMatches(ctx)
	if err != nil || len(matches) == 0 {
		replyErr(ctx, b, i, "❌ Không có dữ liệu trận đấu.")
		return
	}

	match := findNextMatch(matches)
	if match == nil {
		replyErr(ctx, b, i, "❌ Không có trận nào sắp tới.")
		return
	}

	myWagers, _ := b.DB.ReadUserWagers(ctx, userID)
	if w := myWagers[fmt.Sprintf("%d", match.ID)]; w != nil && w.Random {
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       "⚠️  Đã kích hoạt rồi",
				Description: fmt.Sprintf("Random đã bật cho trận `#%d` rồi. Nằm chờ số phận thôi!", match.ID),
				Color:       0xFEE75C,
			}},
		})
		return
	}

	// If user already voted, show confirmation buttons
	if match.MessageID != "" {
		votes, err := b.DB.ReadMatchVotes(ctx, match.ID, match.MessageID)
		if err == nil && votes != nil && votes[userID] != nil {
			currentVote := votes[userID].Vote
			row := discord.ActionRow(
				discord.NewButton(fmt.Sprintf("random-confirm|%d", match.ID), "Xoá vote & random", discord.ButtonDanger),
				discord.NewButton("random-cancel", "Giữ vote", discord.ButtonSecondary),
			)
			replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
				Embeds: []discord.Embed{{
					Title: "⚠️  Bạn đã vote rồi",
					Description: fmt.Sprintf(
						"Bạn đang chọn **%s** cho trận `#%d`.\n\nKích hoạt random sẽ **xoá vote** hiện tại. Chắc chưa?",
						upper(currentVote), match.ID,
					),
					Color: 0xFEE75C,
				}},
				Components: []discord.Component{row},
			})
			return
		}
	}

	if err := activateRandom(ctx, b, i.ActingUser(), match.ID, match.Home, match.Away); err != nil {
		replyErr(ctx, b, i, "❌ Có lỗi xảy ra.")
		return
	}
	randomLine := flavor.PickLine(ctx, b.DB, "random")
	embed := buildRandomEmbed(i.ActingUser(), randomLine, match.ID, match.Home, match.Away)
	reply(ctx, b, i, discord.InteractionCallbackData{Embeds: []discord.Embed{embed}})
}

// HandleRandomButton handles the random-confirm and random-cancel button interactions.
func HandleRandomButton(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	if i.Data.CustomID == "random-cancel" {
		respondUpdateMessage(ctx, b, i, discord.InteractionCallbackData{
			Embeds:     []discord.Embed{{Description: "👍 Giữ nguyên vote. Không random.", Color: 0x57F287}},
			Components: []discord.Component{},
		})
		return
	}

	userID := i.ActingUser().ID
	if _, loaded := randomConfirmPending.LoadOrStore(userID, struct{}{}); loaded {
		return
	}
	defer randomConfirmPending.Delete(userID)

	deferComponentUpdate(ctx, b, i)

	var matchID int
	fmt.Sscanf(i.Data.CustomID, "random-confirm|%d", &matchID)

	matches, err := b.DB.ReadMatches(ctx)
	if err != nil {
		editOriginal(ctx, b, i, discord.EditMessagePayload{Content: "❌ Không có dữ liệu trận đấu.", Components: []discord.Component{}})
		return
	}

	var match *firebase.Match
	for idx := range matches {
		if matches[idx].ID == matchID {
			match = &matches[idx]
			break
		}
	}
	if match == nil {
		editOriginal(ctx, b, i, discord.EditMessagePayload{Content: "⏰ Trận đã bắt đầu hoặc không tìm thấy.", Components: []discord.Component{}})
		return
	}
	kickoff, _ := time.Parse(time.RFC3339, match.Date)
	if time.Now().After(kickoff) {
		editOriginal(ctx, b, i, discord.EditMessagePayload{Content: "⏰ Trận đã bắt đầu.", Components: []discord.Component{}})
		return
	}

	if match.MessageID != "" {
		_ = b.DB.RemoveMatchVote(ctx, match.ID, userID, match.MessageID)
		updatePollEmbed(ctx, b, match.ID, match.MessageID)
	}

	if err := activateRandom(ctx, b, i.ActingUser(), match.ID, match.Home, match.Away); err != nil {
		editOriginal(ctx, b, i, discord.EditMessagePayload{Content: "❌ Có lỗi xảy ra.", Components: []discord.Component{}})
		return
	}

	editOriginal(ctx, b, i, discord.EditMessagePayload{
		Embeds:     []discord.Embed{{Description: "✅ Đã xoá vote và kích hoạt random.", Color: 0x57F287}},
		Components: []discord.Component{},
	})

	randomLine := flavor.PickLine(ctx, b.DB, "random")
	embed := buildRandomEmbed(i.ActingUser(), randomLine, match.ID, match.Home, match.Away)
	followup(ctx, b, i, discord.SendMessagePayload{Embeds: []discord.Embed{embed}})
}

func activateRandom(ctx context.Context, b *bot.Bot, user *discord.User, matchID int, _, _ string) error {
	return b.DB.SetPlayerWager(ctx, user.ID, matchID, "random")
}

func buildRandomEmbed(user *discord.User, randomLine string, matchID int, home, away string) discord.Embed {
	embed := discord.Embed{
		Title: "🎲  RANDOM!",
		Description: fmt.Sprintf(
			"**<@%s>** %s\n\n⚽ **Trận #%d:** %s vs %s\n\n🎲 Nếu không vote trước giờ đá, hệ thống sẽ **random** thay vì gán đội ít vote nhất.",
			user.ID, randomLine, matchID, upper(home), upper(away),
		),
		Color:     0x9B59B6,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	if url := user.AvatarURL(); url != "" {
		embed.Thumbnail = &discord.EmbedImage{URL: url}
	}
	return embed
}

// respondUpdateMessage responds to a component interaction updating the original message.
func respondUpdateMessage(ctx context.Context, b *bot.Bot, i *discord.Interaction, data discord.InteractionCallbackData) {
	resp := discord.InteractionResponse{Type: discord.CallbackUpdateMessage, Data: &data}
	_ = b.REST.RespondToInteraction(ctx, i.ID, i.Token, resp)
}

// deferComponentUpdate sends a deferred update ack for a component interaction.
func deferComponentUpdate(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	resp := discord.InteractionResponse{Type: discord.CallbackDeferredMessageUpdate}
	_ = b.REST.RespondToInteraction(ctx, i.ID, i.Token, resp)
}

// editOriginal edits the original interaction message.
func editOriginal(ctx context.Context, b *bot.Bot, i *discord.Interaction, payload discord.EditMessagePayload) {
	_, _ = b.REST.EditOriginalInteractionResponse(ctx, b.AppID, i.Token, payload)
}
