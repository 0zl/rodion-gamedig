import { Glob } from 'bun'
import winston from 'winston'
import { Client, Events, GatewayIntentBits, Collection, REST, Routes, MessageFlags, type APIEmbedField, TextChannel } from 'discord.js'
import yaml from 'yaml'
import { games } from 'gamedig'
import { queryServer } from './libs/query'

class RodionGamedig {
    FirstRun = true
    Discord = new Client({ intents: [GatewayIntentBits.Guilds] })
    Commands = new Collection<string, any>()
    Logger = winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(info => `[${info.timestamp}] [${info.level.toUpperCase()}]: ${info.message}`)
        ),
        transports: [
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.printf(info => `[${info.timestamp}] [${info.level}]: ${info.message}`)
                )
            }),
            new winston.transports.File({ filename: 'backend.log' })
        ]
    })
    ChannelMessages = new Collection<string, {
        messageId: string,
        data: any
    }>()

    async start() {
        await this.prepareCommands()
        await this.registerCommands()
        this.handleEvents()
        this.Logger.info('Starting bot...')
        await this.Discord.login()

        await this.schedulerAutoEdit()
        setInterval(() => this.schedulerAutoEdit(), 10 * 60 * 1000)
    }

    private async prepareCommands() {
        const glob = new Glob('./commands/**/*.ts')
        const commands = await Array.fromAsync(glob.scan(import.meta.dir))

        for (const command of commands) {
            const imported = await import(command)
            if (imported.default && imported.default.data && imported.default.execute) {
                this.Commands.set(imported.default.data.name, imported.default)
                this.Logger.info(`Loaded command: ${imported.default.data.name}`)
            }
        }

        this.Logger.info(`Total commands loaded: ${this.Commands.size}`)
    }

    private async registerCommands() {
        try {
            const rest = new REST().setToken(Bun.env.DISCORD_TOKEN!)
            const data = await rest.put(
                Routes.applicationGuildCommands(Bun.env.DISCORD_CLIENT_ID!, Bun.env.DISCORD_SERVER_ID!),
                { body: this.Commands.map(cmd => cmd.data.toJSON()) }
            ) as any[]
            this.Logger.info(`Registered ${data.length} commands with Discord API.`)
        } catch (err) {
            console.error(err)
            this.Logger.error(`Error registering commands: ${err}`)
        }
    }

    private handleEvents() {
        this.Discord.once(Events.ClientReady, () => {
            this.Logger.info(`Logged in as ${this.Discord.user?.tag}`)
        })

        this.Discord.on(Events.InteractionCreate, async interaction => {
            if (interaction.isCommand()) {
                const command = this.Commands.get(interaction.commandName)
                if (!command) {
                    this.Logger.warn(`No command found for ${interaction.commandName}`)
                    return
                }

                try {
                    await command.execute(interaction)
                    this.Logger.info(`Executed command: ${interaction.commandName} by ${interaction.user.tag}`)
                } catch (err) {
                    this.Logger.error(`Error executing command ${interaction.commandName}: ${err}`)
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral })
                    } else {
                        await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral })
                    }
                }
            } else if (interaction.isAutocomplete()) {
                const command = this.Commands.get(interaction.commandName)
                if ( !command ) {
                    return
                }

                try {
                    await command.autocomplete(interaction)
                } catch (err) {
                    this.Logger.error(`Error auto-complete command: ${err}`)
                }
            }
        })
    }

    private async schedulerAutoEdit() {
        this.Logger.info('Running scheduled server status update...')
        const config = yaml.parse(await Bun.file('config.yaml').text())
        const channelId = config.discord.serverStatusChannelId

        // delete all messages in the channel
        const channel = await this.Discord.channels.cache.get(channelId)?.fetch()
        const textChannel = channel as TextChannel

        if ( this.FirstRun ) {
            this.FirstRun = false
            const messages = await textChannel.messages.fetch({ limit: 100 })
            for ( const message of messages.values() ) {
                try {
                    await message.delete()
                    await new Promise(res => setTimeout(res, 500))
                } catch (err) {
                    this.Logger.error(`Error deleting message: ${err}`)
                }
            }
        }

        for ( const server of config.servers ) {
            const command = this.Commands.get('check')
            if ( !command ) {
                this.Logger.error('Check command not found.')
                return
            }

            try {
                const result = await queryServer(server.type, server.address)
                if ( !result.success ) {
                    const messageId = this.ChannelMessages.get(server.address)?.messageId
                    if ( messageId ) {
                        try {
                            const existingMessage = await textChannel.messages.fetch(messageId)
                            await existingMessage.edit({
                                embeds: [{
                                    title: `Failed to query server ${server.address}`,
                                    description: `Error: ${result.error}`,
                                    color: 0xFF0000,
                                    footer: {
                                        text: `Last successful data may be outdated.`
                                    }
                                }]
                            })
                            this.Logger.info(`Updated error message for server ${server.address}.`)
                        } catch (err) {
                            this.Logger.warn(`Failed to fetch existing message for server ${server.address}, will create a new one.`)
                            const newMessage = await textChannel.send({
                                embeds: [{
                                    title: `Failed to query server ${server.address}`,
                                    description: `Error: ${result.error}`,
                                    color: 0xFF0000,
                                    footer: {
                                        text: `Last successful data may be outdated.`
                                    }
                                }]
                            })
                            this.ChannelMessages.set(server.address, {
                                messageId: newMessage.id,
                                data: null
                            })
                            this.Logger.info(`Posted new error message for server ${server.address}.`)
                        }
                    } else {
                        const newMessage = await textChannel.send({
                            embeds: [{
                                title: `Failed to query server ${server.address}`,
                                description: `Error: ${result.error}`,
                                color: 0xFF0000,
                                footer: {
                                    text: `Last successful data may be outdated.`
                                }
                            }]
                        })
                        this.ChannelMessages.set(server.address, {
                            messageId: newMessage.id,
                            data: null
                        })
                        this.Logger.info(`Posted new error message for server ${server.address}.`)
                    }
                    continue
                }

                const data = result.data
                if ( !data ) {
                    this.Logger.warn(`No data received from server ${server.address}.`)
                    continue
                }

                const game = games[server.type]!
                const fields: APIEmbedField[] = [
                    { name: '', value: `Playing **${data.map || 'N/A'}** with **${data.players.length}/${data.maxplayers}** players\nConnect via Console: \`connect ${data.connect || server.address}\`` }
                ]

                for ( const player of data.players ) {
                    fields.push({ name: '', value: player.name || 'Unknown player', inline: true })
                }

                let messageId = this.ChannelMessages.get(server.address)?.messageId
                let message

                if ( messageId ) {
                    try {
                        message = await textChannel.messages.fetch(messageId)
                    } catch (err) {
                        this.Logger.warn(`Failed to fetch existing message for server ${server.address}, will create a new one.`)
                        messageId = undefined
                    }
                }

                if ( !message ) {
                    message = await textChannel.send({
                        embeds: [{
                            title: `${data.name}`,
                            color: 0x00FF00,
                            fields: fields,
                            footer: {
                                text: `Updated ${new Date().toLocaleString()} • ${game.name}`
                            }
                        }]
                    })
                    this.ChannelMessages.set(server.address, {
                        messageId: message.id,
                        data: data
                    })
                    this.Logger.info(`Posted new status message for server ${server.address}.`)
                } else {
                    await message.edit({
                        embeds: [{
                            title: `${data.name}`,
                            color: 0x00FF00,
                            fields: fields,
                            footer: {
                                text: `Updated ${new Date().toLocaleString()} • ${game.name}`
                            }
                        }]
                    })
                    this.Logger.info(`Updated status message for server ${server.address}.`)
                }

                await new Promise(res => setTimeout(res, 1000))
            } catch (err) {
                this.Logger.error(`Error processing server ${server.address}: ${err}`)
            }
        }

        this.Logger.info('Scheduled server status update completed.')
    }
}

if (import.meta.main) {
    const bot = new RodionGamedig()
    await bot.start()
}