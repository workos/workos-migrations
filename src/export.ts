import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Auth0Client, Auth0Client as Auth0ClientType, Auth0Connection } from './auth0-client';

interface ExportReport {
  timestamp: string;
  auth0_domain: string;
  clients: ClientReport[];
  connections: ConnectionReport[];
  summary: {
    total_clients: number;
    total_connections: number;
    connections_by_strategy: Record<string, number>;
  };
}

interface ClientReport {
  client_id: string;
  name: string;
  app_type: string;
  is_first_party: boolean;
  enabled_connections: string[];
}

interface ConnectionReport {
  connection_id: string;
  name: string;
  strategy: string;
  display_name: string;
  enabled_clients: EnabledClientInfo[];
  options_summary: {
    has_custom_domain: boolean;
    has_certificate: boolean;
    has_metadata_mapping: boolean;
    strategy_specific_options: Record<string, any>;
  };
}

interface EnabledClientInfo {
  client_id: string;
  client_name: string;
  app_type: string;
}

export async function exportConnections(auth0Client: Auth0Client): Promise<void> {
  try {
    console.log(chalk.blue('📊 Fetching clients...'));
    const clients = await auth0Client.getClients();
    console.log(chalk.green(`✓ Found ${clients.length} clients`));

    console.log(chalk.blue('🔗 Fetching connections...'));
    const connections = await auth0Client.getConnections();
    console.log(chalk.green(`✓ Found ${connections.length} connections`));

    const report = generateReport(clients, connections);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `auth0-export-${timestamp}.json`;
    const filepath = path.join(process.cwd(), filename);

    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));

    console.log(chalk.green(`\n✅ Export completed successfully!`));
    console.log(chalk.blue(`📁 Report saved to: ${filepath}`));
    console.log(chalk.gray(`\n📊 Summary:`));
    console.log(chalk.gray(`   • Total clients: ${report.summary.total_clients}`));
    console.log(chalk.gray(`   • Total connections: ${report.summary.total_connections}`));
    
    if (Object.keys(report.summary.connections_by_strategy).length > 0) {
      console.log(chalk.gray(`   • Connections by strategy:`));
      Object.entries(report.summary.connections_by_strategy).forEach(([strategy, count]) => {
        console.log(chalk.gray(`     - ${strategy}: ${count}`));
      });
    }

  } catch (error) {
    throw new Error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function generateReport(clients: Auth0ClientType[], connections: Auth0Connection[]): ExportReport {
  const clientMap = new Map(clients.map(client => [client.client_id, client]));
  
  const clientReports: ClientReport[] = clients.map(client => {
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

  const connectionReports: ConnectionReport[] = connections.map(connection => {
    const enabledClientInfos: EnabledClientInfo[] = connection.enabled_clients
      .map(clientId => {
        const client = clientMap.get(clientId);
        if (!client) return null;
        
        return {
          client_id: clientId,
          client_name: client.name,
          app_type: client.app_type,
        };
      })
      .filter((info): info is EnabledClientInfo => info !== null);

    const options = connection.options || {};
    
    const optionsSummary = {
      has_custom_domain: !!(options.domain || options.tenant_domain),
      has_certificate: !!(options.signing_cert || options.certificate || options.x509_cert),
      has_metadata_mapping: !!(options.field_map || options.attribute_map || options.user_id_attribute),
      strategy_specific_options: extractStrategySpecificOptions(connection.strategy, options),
    };

    return {
      connection_id: connection.id,
      name: connection.name,
      strategy: connection.strategy,
      display_name: connection.display_name || connection.name,
      enabled_clients: enabledClientInfos,
      options_summary: optionsSummary,
    };
  });

  const connectionsByStrategy = connections.reduce((acc, conn) => {
    acc[conn.strategy] = (acc[conn.strategy] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

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

function extractStrategySpecificOptions(strategy: string, options: any): Record<string, any> {
  const strategyOptions: Record<string, any> = {};

  switch (strategy) {
    case 'saml':
      if (options.signInEndpoint) strategyOptions.signInEndpoint = options.signInEndpoint;
      if (options.signatureAlgorithm) strategyOptions.signatureAlgorithm = options.signatureAlgorithm;
      if (options.digestAlgorithm) strategyOptions.digestAlgorithm = options.digestAlgorithm;
      if (options.nameIdentifierFormat) strategyOptions.nameIdentifierFormat = options.nameIdentifierFormat;
      break;
      
    case 'oidc':
      if (options.discovery_url) strategyOptions.discovery_url = options.discovery_url;
      if (options.client_id) strategyOptions.client_id = '[REDACTED]';
      if (options.authorization_endpoint) strategyOptions.authorization_endpoint = options.authorization_endpoint;
      if (options.token_endpoint) strategyOptions.token_endpoint = options.token_endpoint;
      break;
      
    case 'ad':
    case 'adfs':
      if (options.tenant_domain) strategyOptions.tenant_domain = options.tenant_domain;
      if (options.domain_aliases) strategyOptions.domain_aliases = options.domain_aliases;
      break;
      
    case 'okta':
      if (options.domain) strategyOptions.domain = options.domain;
      if (options.client_id) strategyOptions.client_id = '[REDACTED]';
      break;
      
    case 'ping-federate':
      if (options.tenant_domain) strategyOptions.tenant_domain = options.tenant_domain;
      break;
  }

  return strategyOptions;
}