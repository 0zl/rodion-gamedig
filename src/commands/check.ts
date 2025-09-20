import { AutocompleteInteraction, SlashCommandBuilder, type CommandInteraction, type ChatInputCommandInteraction, type APIEmbedField } from 'discord.js'
import { games } from 'gamedig'
import { queryServer } from '../libs/query.js'

type CommandInteractionUnion = CommandInteraction & ChatInputCommandInteraction

export default {
    data: new SlashCommandBuilder()
        .setName('check')
        .setDescription('Check game server status by providing game type and IP address')
        .addStringOption(option =>
            option.setName('type')
                .setRequired(true)
                .setAutocomplete(true)
                .setDescription('Game type'))
        .addStringOption(option =>
            option.setName('address')
                .setRequired(true)
                .setDescription('Server address')),
    
    async autocomplete(i: AutocompleteInteraction) {
        const focused = i.options.getFocused(true)
        if ( focused.name !== 'type' ) return

        let choices = Object.keys(games)
            .filter(c => c.includes(focused.value))
            .map(c => ({
                name: `${c} (${games[c]?.name ?? 'Unknown'})`,
                value: c
            }))
        
        if ( choices.length > 25 ) {
            choices.splice(24)
        }
        
        await i.respond(choices)
    },
    
    async execute(i: CommandInteractionUnion) {
        const type = i.options.getString('type', true)
        const address = i.options.getString('address', true)

        await i.deferReply()

        const result = await queryServer(type, address)
        if ( result.success ) {
            const data = result.data
            if ( !data ) {
                await i.editReply('No data received from server.')
                return
            }
            
            const game = games[type]!
            const fields: APIEmbedField[] = [
                { name: '', value: `Playing **${data.map || 'N/A'}** with **${data.players.length}/${data.maxplayers}** players\nConnect via Console: \`connect ${data.connect || address}\`` }
            ]

            for ( const player of data.players ) {
                fields.push({ name: '', value: player.name || 'Unknown player', inline: true })
            }

            await i.editReply({
                embeds: [{
                    title: `${data.name} Server Status`,
                    color: 0x00FF00,
                    fields: fields,
                    footer: {
                        text: `${game.name} - Rodion Gaming`,
                    }
                }]
            })
        } else {
            await i.editReply(`Error querying server: ${result.error}`)
        }
    }
}