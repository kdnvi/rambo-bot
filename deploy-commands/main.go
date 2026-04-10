package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"

	"github.com/kdnvi/rambo-bot/internal/discord"
)

func main() {
	token := mustEnv("TOKEN")
	appID := mustEnv("APP_ID")
	guildID := mustEnv("GUILD_ID")

	commands := buildCommands()

	body, err := json.Marshal(commands)
	if err != nil {
		slog.Error("marshal commands", "err", err)
		os.Exit(1)
	}

	url := fmt.Sprintf("https://discord.com/api/v10/applications/%s/guilds/%s/commands", appID, guildID)
	req, _ := http.NewRequest(http.MethodPut, url, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bot "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Error("deploy commands request failed", "err", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		slog.Error("deploy commands failed", "status", resp.StatusCode, "body", string(respBody))
		os.Exit(1)
	}

	var deployed []map[string]interface{}
	_ = json.Unmarshal(respBody, &deployed)
	slog.Info("successfully deployed commands", "count", len(deployed))
}

func buildCommands() []discord.CommandDefinition {
	intPtr := func(v float64) *float64 { return &v }
	return []discord.CommandDefinition{
		{Name: "register", Description: "Đăng ký tham gia giải"},
		{Name: "schedule", Description: "Lịch sắp tới — chuẩn bị tinh thần đi", Options: []discord.CommandOption{
			{Type: discord.OptionInteger, Name: "count", Description: "Số trận muốn xem (mặc định 5)", MinValue: intPtr(1), MaxValue: intPtr(10)},
		}},
		{Name: "match", Description: "Chi tiết trận đấu — ai đúng ai sai, rõ ràng", Options: []discord.CommandOption{
			{Type: discord.OptionInteger, Name: "id", Description: "ID trận (bỏ trống = trận gần nhất)", MinValue: intPtr(1)},
		}},
		{Name: "stats", Description: "Thống kê cá nhân — đối mặt sự thật đi", Options: []discord.CommandOption{
			{Type: discord.OptionUser, Name: "user", Description: "Soi ai (bỏ trống = soi mình)"},
		}},
		{Name: "rank", Description: "Bảng xếp hạng — ai đầu bảng, ai đội sổ"},
		{Name: "history", Description: "Lịch sử kết quả — nhìn lại quá khứ đau thương", Options: []discord.CommandOption{
			{Type: discord.OptionUser, Name: "user", Description: "Soi ai (bỏ trống = soi mình)"},
			{Type: discord.OptionInteger, Name: "count", Description: "Số trận muốn xem (mặc định 5)", MinValue: intPtr(1), MaxValue: intPtr(20)},
		}},
		{Name: "group", Description: "Bảng xếp hạng vòng bảng", Options: []discord.CommandOption{
			{Type: discord.OptionString, Name: "name", Description: "Tên bảng (A–L), bỏ trống = xem hết"},
		}},
		{Name: "worldcup-playoff", Description: "Nhánh đấu vòng 32 — ai gặp ai, run chưa?"},
		{Name: "random", Description: "Giao số phận cho ông trời — random thay vì bị gán đội ít vote nhất"},
		{Name: "double-down", Description: "Nhân đôi cược — gan thì bấm, mỗi ngày 1 lần"},
		{Name: "undo-double-down", Description: "Huỷ double-down trận tới"},
		{Name: "curse", Description: "Nguyền một người ở trận tới — người đó sai thì bạn ăn 5 điểm!", Options: []discord.CommandOption{
			{Type: discord.OptionUser, Name: "player", Description: "Chọn nạn nhân", Required: true},
		}},
		{Name: "uncurse", Description: "Huỷ lời nguyền đang hoạt động"},
		{Name: "update-result", Description: "Cập nhật kết quả trận đấu — quyền sinh sát trong tay", Options: []discord.CommandOption{
			{Type: discord.OptionInteger, Name: "match-id", Description: "ID trận", Required: true, MinValue: intPtr(1)},
			{Type: discord.OptionInteger, Name: "home-score", Description: "Bàn đội nhà", Required: true, MinValue: intPtr(0), MaxValue: intPtr(99)},
			{Type: discord.OptionInteger, Name: "away-score", Description: "Bàn đội khách", Required: true, MinValue: intPtr(0), MaxValue: intPtr(99)},
		}},
		{Name: "spam", Description: "Spam một người cho vui", Options: []discord.CommandOption{
			{Type: discord.OptionUser, Name: "user", Description: "Nạn nhân", Required: true},
		}},
		{Name: "rule", Description: "Xem luật chơi"},
		{Name: "wall-of-shame", Description: "Bảng nhục — những kẻ thua đau nhất"},
	}
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		slog.Error("missing required env var", "key", key)
		os.Exit(1)
	}
	return v
}
