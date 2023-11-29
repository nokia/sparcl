<script>
    export let options = [];
    export let displayFunc = (a) => a;
    export let index = 0;
    export let value;
    export let fontSize = 18;
    $: {
        value = options[index];
    }
</script>

<select style={`font-size: ${fontSize}px`} bind:value={index}>
    {#each options as option, i}
        <option value={i}>{displayFunc(option)}</option>
    {/each}
</select>
