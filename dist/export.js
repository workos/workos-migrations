"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportConnections = exportConnections;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
async function exportConnections(auth0Client) {
    try {
        console.log(chalk_1.default.blue('📊 Fetching clients...'));
        const clients = await auth0Client.getClients();
        console.log(chalk_1.default.green(`✓ Found ${clients.length} clients`));
        console.log(chalk_1.default.blue('🔗 Fetching connections...'));
        const connections = await auth0Client.getConnections();
        console.log(chalk_1.default.green(`✓ Found ${connections.length} connections`));
        const report = generateReport(clients, connections);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `auth0-export-${timestamp}.json`;
        const filepath = path_1.default.join(process.cwd(), filename);
        fs_1.default.writeFileSync(filepath, JSON.stringify(report, null, 2));
        console.log(chalk_1.default.green(`\n✅ Export completed successfully!`));
        console.log(chalk_1.default.blue(`📁 Report saved to: ${filepath}`));
        console.log(chalk_1.default.gray(`\n📊 Summary:`));
        console.log(chalk_1.default.gray(`   • Total clients: ${report.summary.total_clients}`));
        console.log(chalk_1.default.gray(`   • Total connections: ${report.summary.total_connections}`));
        if (Object.keys(report.summary.connections_by_strategy).length > 0) {
            console.log(chalk_1.default.gray(`   • Connections by strategy:`));
            Object.entries(report.summary.connections_by_strategy).forEach(([strategy, count]) => {
                console.log(chalk_1.default.gray(`     - ${strategy}: ${count}`));
            });
        }
    }
    catch (error) {
        throw new Error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
function generateReport(clients, connections) {
    const clientMap = new Map(clients.map(client => [client.client_id, client]));
    const clientReports = clients.map(client => {
        const enabledConnections = connections
            .filter(conn => conn.enabled_clients.includes(client.client_id))
            .map(conn => conn.name);
        return {
            client_id: client.client_id,
            name: client.name,
            app_type: client.app_type,
            is_first_party: client.is_first_party,
            enabled_connections: enabledConnections,
        };
    });
    const connectionReports = connections.map(connection => {
        const enabledClientInfos = connection.enabled_clients
            .map(clientId => {
            const client = clientMap.get(clientId);
            if (!client)
                return null;
            return {
                client_id: clientId,
                client_name: client.name,
                app_type: client.app_type,
            };
        })
            .filter((info) => info !== null);
        return {
            connection_id: connection.id,
            name: connection.name,
            strategy: connection.strategy,
            display_name: connection.display_name || connection.name,
            enabled_clients: enabledClientInfos,
            options: connection.options || {},
            full_connection_data: connection,
        };
    });
    const connectionsByStrategy = connections.reduce((acc, conn) => {
        acc[conn.strategy] = (acc[conn.strategy] || 0) + 1;
        return acc;
    }, {});
    return {
        timestamp: new Date().toISOString(),
        auth0_domain: '', // Will be filled by the calling function if needed
        clients: clientReports,
        connections: connectionReports,
        summary: {
            total_clients: clients.length,
            total_connections: connections.length,
            connections_by_strategy: connectionsByStrategy,
        },
    };
}
//# sourceMappingURL=export.js.map