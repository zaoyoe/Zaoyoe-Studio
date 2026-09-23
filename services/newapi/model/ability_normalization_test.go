package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestSplitAndTrimCSVNormalizesEntries(t *testing.T) {
	require.Equal(t, []string{"gpt-6-sol", "claude-sonnet"}, splitAndTrimCSV(" gpt-6-sol , ,claude-sonnet, gpt-6-sol "))
	require.Empty(t, splitAndTrimCSV(" ,  , "))
}

func TestChannelGetModelsTrimsWhitespace(t *testing.T) {
	channel := &Channel{Models: " gpt-6-sol , ,claude-sonnet "}
	require.Equal(t, []string{"gpt-6-sol", "claude-sonnet"}, channel.GetModels())
}

func TestChannelAbilitiesTrimModelAndGroupWhitespace(t *testing.T) {
	truncateTables(t)
	channel := &Channel{
		Id:     918273,
		Models: " gpt-6-sol , ,gpt-6-sol ",
		Group:  " team-a , team-b ",
		Status: common.ChannelStatusEnabled,
	}

	require.NoError(t, channel.AddAbilities(nil))
	var abilities []Ability
	require.NoError(t, DB.Where("channel_id = ?", channel.Id).Order("`group` asc").Find(&abilities).Error)
	require.Len(t, abilities, 2)
	require.Equal(t, "gpt-6-sol", abilities[0].Model)
	require.Equal(t, "team-a", abilities[0].Group)
	require.Equal(t, "gpt-6-sol", abilities[1].Model)
	require.Equal(t, "team-b", abilities[1].Group)

	channel.Models = " other-model , "
	channel.Group = " team-c "
	require.NoError(t, channel.UpdateAbilities(nil))
	abilities = nil
	require.NoError(t, DB.Where("channel_id = ?", channel.Id).Find(&abilities).Error)
	require.Len(t, abilities, 1)
	require.Equal(t, "other-model", abilities[0].Model)
	require.Equal(t, "team-c", abilities[0].Group)
}
