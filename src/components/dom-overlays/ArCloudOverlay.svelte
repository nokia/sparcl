<!--
  (c) 2021 Open AR Cloud
  This code is licensed under MIT license (see LICENSE.md for details)

  (c) 2024 Nokia
  Licensed under the MIT License
  SPDX-License-Identifier: MIT
-->

<!-- DOM-overlay on top of AR canvas AR mode is OSCP -->
<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { isLocalizingMessage, isLocalizedMessage, localizeMessage, localizeLabel, movePhoneMessage, resetLabel } from '@src/contentStore';
    import { isUserOnRobotPath, userOnRobotPathBlinkingAlert } from '@src/stateStore';
    import Select from './Select.svelte';

    export let hasPose = false;
    export let agentInfo;
    export let isLocalizing = false;
    export let isLocalized = false;
    let showIsLocalizedMessage: boolean = false;
    $: {
        if (isLocalized) {
            showIsLocalizedMessage = true;
            setTimeout(() => {
                showIsLocalizedMessage = false;
            }, 3000);
        }
    }
    export let receivedContentTitles: string[] = [];
    let agentSelected;

    // Used to dispatch events to parent
    const dispatch = createEventDispatcher();
    const blinkingAlertStates = {
        state1: 'color: red',
        state2: 'color: black',
    };
    $: dispatch('agentSelected', agentSelected);
</script>

{#if $isUserOnRobotPath}
    <p style={blinkingAlertStates[$userOnRobotPathBlinkingAlert] ?? ''}>DANGER! You are intersecting with a robot's path!</p>
{/if}

{#if !hasPose}
    <p>{$movePhoneMessage}</p>
{:else if isLocalizing}
    <img class="spinner" alt="Waiting spinner" src="/media/spinner.svg" />
    <p>{$isLocalizingMessage}</p>
{:else if hasPose && !isLocalized}
    <p>{$localizeMessage}</p>
    <button on:click={() => dispatch('startLocalisation')}>{$localizeLabel}</button>
{:else if isLocalized}
    <div style="padding-top: 10px;"></div>
    {#if showIsLocalizedMessage}
        <p>{$isLocalizedMessage}</p>
    {/if}
    {#if Object.values(agentInfo).length > 0}
        <div style="padding-top: 15px; padding-bottom: 15px;">
            <Select fontSize={20} bind:value={agentSelected} displayFunc={(option) => option.agentName} options={Object.values(agentInfo)}></Select>
        </div>
        <div style="padding-top: 15px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75em;">
            <button on:click={() => dispatch('sendWaypoint')}>Send waypoint</button>
            <button on:click={() => dispatch('relocalize')}>{$resetLabel}</button>
        </div>
    {:else}
        <button on:click={() => dispatch('relocalize')}>{$resetLabel}</button>
    {/if}
    {#if receivedContentTitles.length > 0}
        <div align="left">
            <p>Received objects(s):</p>
            {#each receivedContentTitles as title, i}
                <li>[{i}] {title}</li>
            {/each}
        </div>
    {/if}
    <div style="padding-top: 10px"></div>
{/if}

<style>
    .spinner {
        height: 50px;
    }

    button {
        width: 100%;
        height: 49px;

        margin-bottom: 27px;

        font-size: 18px;
        font-weight: bold;

        background-color: white;
        border: 2px solid #2e4458;
        border-radius: var(--ui-radius);
    }
</style>
