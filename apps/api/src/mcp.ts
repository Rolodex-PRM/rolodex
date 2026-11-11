import {
  AppError,
  authenticateMcpAuth,
  mcpContactNetwork,
  mcpGetContact,
  mcpListInteractions,
  mcpListNotes,
  mcpListRelationships,
  mcpListTasks,
  mcpListWorkspaces,
  mcpSearchContacts,
  mcpSearchNetwork,
  type PublicUser,
} from '@rolodex/core'
import type { Database } from '@rolodex/db'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Express, NextFunction, Request, Response } from 'express'
import { z } from 'zod'

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function errorResult(error: unknown) {
  const message = error instanceof AppError ? error.message : error instanceof Error ? error.message : 'Request failed'
  return { content: [{ type: 'text' as const, text: message }], isError: true as const }
}

function createServer(db: Database, user: PublicUser) {
  const server = new McpServer({ name: 'rolodex', version: '0.1.0' })
  const workspaceId = z.string().uuid().optional().describe('Workspace id. Defaults to the first workspace with MCP enabled.')

  server.registerTool(
    'list_workspaces',
    {
      description: 'List Rolodex workspaces for the signed-in user and whether MCP is enabled on each.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return textResult(await mcpListWorkspaces(db, user.id))
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'search_contacts',
    {
      description: 'Search people in a workspace by name, organization, tags, notes, or relationships.',
      inputSchema: {
        workspaceId,
        q: z.string().optional().describe('Search text'),
        limit: z.number().int().min(1).max(200).optional().describe('Max rows to return (default 25)'),
      },
    },
    async (input) => {
      try {
        return textResult(await mcpSearchContacts(db, user.id, input))
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'get_contact',
    {
      description: 'Get one contact record, including methods, addresses, tags, and private fields the caller can see.',
      inputSchema: {
        workspaceId,
        contactId: z.string().uuid().describe('Contact id'),
      },
    },
    async (input) => {
      try {
        return textResult(await mcpGetContact(db, user.id, input))
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'list_relationships',
    {
      description: 'List named relationships from a contact to other people.',
      inputSchema: {
        workspaceId,
        contactId: z.string().uuid().describe('Contact id'),
      },
    },
    async (input) => {
      try {
        return textResult(await mcpListRelationships(db, user.id, input))
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'list_interactions',
    {
      description: 'List interaction / activity history, optionally filtered to one contact.',
      inputSchema: {
        workspaceId,
        contactId: z.string().uuid().optional().describe('Contact id. Omit for recent workspace activity.'),
      },
    },
    async (input) => {
      try {
        return textResult(await mcpListInteractions(db, user.id, input))
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'list_notes',
    {
      description: 'List notes for a contact that the caller can read.',
      inputSchema: {
        workspaceId,
        contactId: z.string().uuid().describe('Contact id'),
      },
    },
    async (input) => {
      try {
        return textResult(await mcpListNotes(db, user.id, input))
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'list_tasks',
    {
      description: 'List tasks, optionally filtered to one contact.',
      inputSchema: {
        workspaceId,
        contactId: z.string().uuid().optional().describe('Contact id'),
      },
    },
    async (input) => {
      try {
        return textResult(await mcpListTasks(db, user.id, input))
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'contact_network',
    {
      description: 'Return the local relationship network around one contact.',
      inputSchema: {
        workspaceId,
        contactId: z.string().uuid().describe('Contact id'),
      },
    },
    async (input) => {
      try {
        return textResult(await mcpContactNetwork(db, user.id, input))
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'search_network',
    {
      description: 'Search the relationship network graph by person or organization name.',
      inputSchema: {
        workspaceId,
        q: z.string().min(1).describe('Search text'),
      },
    },
    async (input) => {
      try {
        return textResult(await mcpSearchNetwork(db, user.id, input))
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  return server
}

export function mountMcp(app: Express, db: Database) {
  const handle = async (req: Request, res: Response) => {
    const user = await authenticateMcpAuth(db, typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined)
    if (!user) {
      res.status(401).json({ error: 'Sign in with a Bearer session token or Basic email:client-password' })
      return
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed. Use POST to /mcp.' },
        id: null,
      })
      return
    }

    const server = createServer(db, user)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      console.error(error)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        })
      }
    } finally {
      res.on('close', () => {
        void transport.close()
        void server.close()
      })
    }
  }

  app.all('/mcp', (req: Request, res: Response, next: NextFunction) => {
    void handle(req, res).catch(next)
  })
  app.all('/mcp/', (req: Request, res: Response, next: NextFunction) => {
    void handle(req, res).catch(next)
  })
}
