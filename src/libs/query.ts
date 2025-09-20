import { GameDig } from 'gamedig'

function parseAddress(address: string) {
    const parts = address.split(':')
    return {
        host: parts[0],
        port: parts[1] ? parseInt(parts[1]) : undefined
    }
}

export async function queryServer(type: string, address: string) {
    try {
        const { host, port } = parseAddress(address)
        if ( !host ) {
            throw new Error('Invalid address format')
        }

        console.log(`Querying ${type} server at ${host}${port ? `:${port}` : ''}...`)
        const result = await GameDig.query({
            type: type,
            host: host,
            port: port,
            maxRetries: 3
        })

        return { success: true, data: result }
    } catch (err) {
        console.error(err)
        return { success: false, error: (err as Error).message }
    }
}