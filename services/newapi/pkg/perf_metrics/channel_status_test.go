package perfmetrics

import (
	"testing"
	"time"
)

func TestRecentBarsFiveRequestWindows(t *testing.T) {
	resetChannelStatusForTest()
	for i := 0; i < 40; i++ {
		recordRecent("pro", true)
	}
	for i := 0; i < 2; i++ {
		for j := 0; j < 4; j++ {
			recordRecent("pro", true)
		}
		recordRecent("pro", false)
	}

	result, err := QueryChannelStatus("recent", []string{"pro", "auto"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Window != "recent" {
		t.Fatalf("window = %s", result.Window)
	}
	if len(result.AvailableWindows) != 5 {
		t.Fatalf("available windows = %#v", result.AvailableWindows)
	}
	if len(result.Groups) != 1 {
		t.Fatalf("groups = %#v", result.Groups)
	}
	group := result.Groups[0]
	if group.Group != "pro" {
		t.Fatalf("group = %s", group.Group)
	}
	if group.SuccessRate == nil || *group.SuccessRate != 96 {
		t.Fatalf("success rate = %v", group.SuccessRate)
	}
	if len(group.Series) != 10 {
		t.Fatalf("series len = %d", len(group.Series))
	}
	for i := 0; i < 8; i++ {
		if group.Series[i].SuccessRate == nil || *group.Series[i].SuccessRate != 100 {
			t.Fatalf("bar %d = %v", i, group.Series[i].SuccessRate)
		}
	}
	for i := 8; i < 10; i++ {
		if group.Series[i].SuccessRate == nil || *group.Series[i].SuccessRate != 80 {
			t.Fatalf("bar %d = %v", i, group.Series[i].SuccessRate)
		}
	}
}

func TestRecentBarsPadsMissingSamples(t *testing.T) {
	resetChannelStatusForTest()
	recordRecent("pro", true)
	recordRecent("pro", true)
	recordRecent("pro", false)

	result, err := QueryChannelStatus("recent", []string{"pro"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Groups) != 1 {
		t.Fatalf("groups = %#v", result.Groups)
	}
	series := result.Groups[0].Series
	if len(series) != 10 {
		t.Fatalf("series len = %d", len(series))
	}
	for i := 0; i < 9; i++ {
		if series[i].SuccessRate != nil {
			t.Fatalf("bar %d should be empty, got %v", i, series[i].SuccessRate)
		}
	}
	if series[9].SuccessRate == nil || *series[9].SuccessRate != 66.67 {
		t.Fatalf("last bar = %v", series[9].SuccessRate)
	}
}

func TestRecentBarsHidesInactiveGroups(t *testing.T) {
	resetChannelStatusForTest()
	recordRecent("hidden", true)
	recordRecent("visible", true)

	result, err := QueryChannelStatus("recent", []string{"visible"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Groups) != 1 || result.Groups[0].Group != "visible" {
		t.Fatalf("groups = %#v", result.Groups)
	}
}

func TestRecordHooksRecentRing(t *testing.T) {
	resetChannelStatusForTest()
	Record(Sample{Group: "live", Success: true})
	Record(Sample{Group: "live", Success: false})

	result, err := QueryChannelStatus("recent", []string{"live"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Groups) != 1 || result.Groups[0].SuccessRate == nil || *result.Groups[0].SuccessRate != 50 {
		t.Fatalf("groups = %#v", result.Groups)
	}
}

func TestAlignedSeriesPadsMissingHours(t *testing.T) {
	now := time.Unix(1789128000, 0).UTC() // 2026-09-11 12:00:00 UTC
	end := now.Unix() - (now.Unix() % 3600)
	start := end - 23*3600
	buckets := map[int64]counters{
		end: {requestCount: 10, successCount: 8},
	}
	series, total := alignedSeries(start, 24, 3600, buckets)
	if len(series) != 24 {
		t.Fatalf("len = %d", len(series))
	}
	for i := 0; i < 23; i++ {
		if series[i].SuccessRate != nil {
			t.Fatalf("bar %d should be empty", i)
		}
		if series[i].Ts == nil || *series[i].Ts != start+int64(i)*3600 {
			t.Fatalf("bar %d ts = %v", i, series[i].Ts)
		}
	}
	if series[23].SuccessRate == nil || *series[23].SuccessRate != 80 {
		t.Fatalf("last bar = %v", series[23].SuccessRate)
	}
	if total.requestCount != 10 || total.successCount != 8 {
		t.Fatalf("total = %#v", total)
	}
}

func TestNormalizeChannelStatusWindow(t *testing.T) {
	if got := normalizeChannelStatusWindow("7d"); got != "7d" {
		t.Fatalf("got %s", got)
	}
	if got := normalizeChannelStatusWindow("nope"); got != "recent" {
		t.Fatalf("got %s", got)
	}
}
