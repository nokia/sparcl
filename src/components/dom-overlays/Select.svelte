<script>
    export let options = [];
    export let displayFunc = (a) => a;
    export let index = 0;
    export let value;
    $: {
        value = options[index];
    }
</script>

<select bind:value={index}>
    {#each options as option, i}
        <option value={i}>{displayFunc(option)}</option>
    {/each}
</select>
