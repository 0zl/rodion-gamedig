import { SlashCommandBuilder, type CommandInteraction } from 'discord.js'

export default {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Testing command to check if the bot is responsive'),
    
    async execute(i: CommandInteraction) {
        await i.reply('Meow!')
    }
}