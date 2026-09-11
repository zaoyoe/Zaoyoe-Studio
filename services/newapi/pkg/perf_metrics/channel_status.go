package perfmetrics

import (
	"math"
	"sort"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/model"
)

const (
	channelStatusRecentBarCount = 10
	channelStatusRecentBarSize  = 5
	channelStatusRecentSamples  = channelStatusRecentBarCount * channelStatusRecentBarSize
)

var channelStatusWindows = []string{"recent", "24h", "7d", "15d", "30d"}

var recentRings sync.Map

type ChannelStatusPoint struct {
	Ts          *int64   `json:"ts,omitempty"`
	SuccessRate *float64 `json:"success_rate"`
}

type ChannelStatusGroup struct {
	Group        string               `json:"group"`
	SuccessRate  *float64             `json:"success_rate"`
	Series       []ChannelStatusPoint `json:"series"`
	AvgTps       *float64             `json:"avg_tps,omitempty"`
	AvgTtftMs    *int64               `json:"avg_ttft_ms,omitempty"`
	AvgLatencyMs *int64               `json:"avg_latency_ms,omitempty"`
}

type ChannelStatusDisplay struct {
	ShowTps     bool `json:"show_tps"`
	ShowTtft    bool `json:"show_ttft"`
	ShowLatency bool `json:"show_latency"`
}

type ChannelStatusResult struct {
	Window           string               `json:"window"`
	AvailableWindows []string             `json:"available_windows"`
	UpdatedAt        int64                `json:"updated_at"`
	Display          ChannelStatusDisplay `json:"display"`
	Groups           []ChannelStatusGroup `json:"groups"`
}

type recentRing struct {
	mu      sync.Mutex
	samples []bool
}

func (r *recentRing) add(success bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.samples = append(r.samples, success)
	if len(r.samples) > channelStatusRecentSamples {
		r.samples = append([]bool(nil), r.samples[len(r.samples)-channelStatusRecentSamples:]...)
	}
}

func (r *recentRing) snapshot() []bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]bool, len(r.samples))
	copy(out, r.samples)
	return out
}

func recordRecent(group string, success bool) {
	if group == "" {
		return
	}
	actual, _ := recentRings.LoadOrStore(group, &recentRing{})
	actual.(*recentRing).add(success)
}

func QueryChannelStatus(window string, groups []string) (ChannelStatusResult, error) {
	return queryChannelStatusAt(window, groups, time.Now())
}

func queryChannelStatusAt(window string, groups []string, now time.Time) (ChannelStatusResult, error) {
	window = normalizeChannelStatusWindow(window)
	result := ChannelStatusResult{
		Window:           window,
		AvailableWindows: append([]string(nil), channelStatusWindows...),
		UpdatedAt:        now.Unix(),
		Display:          ChannelStatusDisplay{},
		Groups:           []ChannelStatusGroup{},
	}

	if window == "recent" {
		result.Groups = queryRecentGroups(groups)
		return result, nil
	}

	built, err := queryTimeWindowGroups(window, groups, now)
	if err != nil {
		return ChannelStatusResult{}, err
	}
	result.Groups = built
	return result, nil
}

func normalizeChannelStatusWindow(window string) string {
	switch window {
	case "24h", "7d", "15d", "30d":
		return window
	default:
		return "recent"
	}
}

func queryRecentGroups(groups []string) []ChannelStatusGroup {
	allowed := allowedGroupSet(groups)
	out := make([]ChannelStatusGroup, 0)
	recentRings.Range(func(key, value any) bool {
		group, _ := key.(string)
		if group == "" {
			return true
		}
		if allowed != nil {
			if _, ok := allowed[group]; !ok {
				return true
			}
		}
		ring, _ := value.(*recentRing)
		if ring == nil {
			return true
		}
		rate, series := recentBars(ring.snapshot())
		if rate == nil {
			return true
		}
		out = append(out, ChannelStatusGroup{
			Group:       group,
			SuccessRate: rate,
			Series:      series,
		})
		return true
	})
	sort.Slice(out, func(i, j int) bool {
		return out[i].Group < out[j].Group
	})
	return out
}

func recentBars(samples []bool) (*float64, []ChannelStatusPoint) {
	if len(samples) > channelStatusRecentSamples {
		samples = samples[len(samples)-channelStatusRecentSamples:]
	}
	have := make([]bool, channelStatusRecentSamples)
	values := make([]bool, channelStatusRecentSamples)
	offset := channelStatusRecentSamples - len(samples)
	for i, sample := range samples {
		idx := offset + i
		have[idx] = true
		values[idx] = sample
	}

	series := make([]ChannelStatusPoint, channelStatusRecentBarCount)
	var totalReq, totalOk int64
	for i := 0; i < channelStatusRecentBarCount; i++ {
		var req, ok int64
		start := i * channelStatusRecentBarSize
		for j := 0; j < channelStatusRecentBarSize; j++ {
			idx := start + j
			if !have[idx] {
				continue
			}
			req++
			if values[idx] {
				ok++
			}
		}
		if req == 0 {
			continue
		}
		rate := roundRate(ok, req)
		series[i].SuccessRate = &rate
		totalReq += req
		totalOk += ok
	}
	if totalReq == 0 {
		return nil, series
	}
	rate := roundRate(totalOk, totalReq)
	return &rate, series
}

func queryTimeWindowGroups(window string, groups []string, now time.Time) ([]ChannelStatusGroup, error) {
	startTs, endTs, barCount, step := windowRange(window, now)
	rows, err := model.GetPerfMetricsGroupBuckets(startTs, endTs, groups)
	if err != nil {
		return nil, err
	}

	merged := map[string]map[int64]counters{}
	for _, row := range rows {
		if row.RequestCount == 0 {
			continue
		}
		align := alignBucket(window, row.BucketTs)
		if align < startTs || align > endTs {
			continue
		}
		if _, ok := merged[row.Group]; !ok {
			merged[row.Group] = map[int64]counters{}
		}
		current := merged[row.Group][align]
		current.requestCount += row.RequestCount
		current.successCount += row.SuccessCount
		current.totalLatencyMs += row.TotalLatencyMs
		current.ttftSumMs += row.TtftSumMs
		current.ttftCount += row.TtftCount
		current.outputTokens += row.OutputTokens
		current.generationMs += row.GenerationMs
		merged[row.Group][align] = current
	}

	allowed := allowedGroupSet(groups)
	hotBuckets.Range(func(key, value any) bool {
		k := key.(bucketKey)
		if k.bucketTs < startTs || k.bucketTs > endTs {
			return true
		}
		if allowed != nil {
			if _, ok := allowed[k.group]; !ok {
				return true
			}
		}
		snap := value.(*atomicBucket).snapshot()
		if snap.requestCount == 0 {
			return true
		}
		align := alignBucket(window, k.bucketTs)
		if align < startTs || align > endTs {
			return true
		}
		if _, ok := merged[k.group]; !ok {
			merged[k.group] = map[int64]counters{}
		}
		current := merged[k.group][align]
		current.requestCount += snap.requestCount
		current.successCount += snap.successCount
		current.totalLatencyMs += snap.totalLatencyMs
		current.ttftSumMs += snap.ttftSumMs
		current.ttftCount += snap.ttftCount
		current.outputTokens += snap.outputTokens
		current.generationMs += snap.generationMs
		merged[k.group][align] = current
		return true
	})

	names := make([]string, 0, len(merged))
	for group := range merged {
		names = append(names, group)
	}
	sort.Strings(names)

	out := make([]ChannelStatusGroup, 0, len(names))
	for _, group := range names {
		series, total := alignedSeries(startTs, barCount, step, merged[group])
		if total.requestCount == 0 {
			continue
		}
		rate := roundRate(total.successCount, total.requestCount)
		out = append(out, ChannelStatusGroup{
			Group:       group,
			SuccessRate: &rate,
			Series:      series,
		})
	}
	return out, nil
}

func windowRange(window string, now time.Time) (startTs int64, endTs int64, barCount int, step int64) {
	switch window {
	case "24h":
		endTs = now.Unix() - (now.Unix() % 3600)
		barCount = 24
		step = 3600
		startTs = endTs - int64(barCount-1)*step
		return startTs, endTs, barCount, step
	case "7d":
		barCount = 7
	case "15d":
		barCount = 15
	case "30d":
		barCount = 30
	default:
		endTs = now.Unix() - (now.Unix() % 3600)
		return endTs, endTs, 1, 3600
	}
	endTs = dayStart(now.Unix())
	step = 24 * 3600
	startTs = endTs - int64(barCount-1)*step
	return startTs, endTs, barCount, step
}

func alignBucket(window string, ts int64) int64 {
	if window == "24h" {
		return ts - (ts % 3600)
	}
	return dayStart(ts)
}

func dayStart(ts int64) int64 {
	t := time.Unix(ts, 0).In(time.Local)
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
	return d.Unix()
}

func alignedSeries(startTs int64, barCount int, step int64, buckets map[int64]counters) ([]ChannelStatusPoint, counters) {
	series := make([]ChannelStatusPoint, barCount)
	var total counters
	for i := 0; i < barCount; i++ {
		ts := startTs + int64(i)*step
		point := ChannelStatusPoint{Ts: &ts}
		value, ok := buckets[ts]
		if ok && value.requestCount > 0 {
			rate := roundRate(value.successCount, value.requestCount)
			point.SuccessRate = &rate
			total.requestCount += value.requestCount
			total.successCount += value.successCount
			total.totalLatencyMs += value.totalLatencyMs
			total.ttftSumMs += value.ttftSumMs
			total.ttftCount += value.ttftCount
			total.outputTokens += value.outputTokens
			total.generationMs += value.generationMs
		}
		series[i] = point
	}
	return series, total
}

func roundRate(ok, total int64) float64 {
	if total <= 0 {
		return 0
	}
	return math.Round(float64(ok)/float64(total)*10000) / 100
}

func resetChannelStatusForTest() {
	recentRings.Range(func(key, _ any) bool {
		recentRings.Delete(key)
		return true
	})
}
