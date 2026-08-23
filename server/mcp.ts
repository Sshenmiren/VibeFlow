import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  findFeature, getFileRole, getImpact, getNodeSource, getProjectSummary, listProjects, resolveStore,
} from './mcp-tools.ts';

/**
 * VibeFlow MCP Server —— 让 Claude Code / 其他 coding agent 直接查询项目地图。
 * 接入方式（在任意终端）：
 *   claude mcp add vibeflow -- npx -y tsx <本仓库路径>/server/mcp.ts
 * 之后在 Claude Code 里就能问："支付逻辑在哪个文件？"它会直接查图回答，不用重新扫描。
 */

const server = new McpServer({ name: 'vibeflow', version: '0.1.0' });

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 1) }] });

server.tool(
  'list_projects',
  '列出 VibeFlow 已分析过的项目（名称、路径、一句话总述）',
  {},
  async () => text(listProjects()),
);

server.tool(
  'get_project_summary',
  '获取某个项目的地图概览：项目总述、技术栈、各视图节点数、分析时间与 git commit',
  { project_path: z.string().describe('项目根目录绝对路径') },
  async ({ project_path }) => text(getProjectSummary(resolveStore(project_path))),
);

server.tool(
  'find_feature',
  '按自然语言关键词搜索业务功能节点，返回功能说明和真实源码位置（文件+符号+行号）。回答"XX功能在哪"用这个。',
  { project_path: z.string(), query: z.string().describe('关键词，如"支付" "存档" "开始游戏"') },
  async ({ project_path, query }) => text(findFeature(resolveStore(project_path), query)),
);

server.tool(
  'get_node_source',
  '获取某个业务节点的详情和对应的真实源码片段',
  { project_path: z.string(), node_id: z.string().describe('find_feature 返回的节点 id') },
  async ({ project_path, node_id }) => text(getNodeSource(resolveStore(project_path), node_id) ?? { error: '节点不存在' }),
);

server.tool(
  'get_file_role',
  '反查一个文件在业务地图中的角色：它被哪些业务环节使用、有哪些符号/路由、被哪些文件导入',
  { project_path: z.string(), file: z.string().describe('相对项目根的文件路径') },
  async ({ project_path, file }) => text(getFileRole(resolveStore(project_path), file)),
);

server.tool(
  'get_impact',
  '影响范围分析：改动某个节点或文件会波及哪些下游文件和业务环节',
  { project_path: z.string(), node_or_file: z.string().describe('节点 id 或文件相对路径') },
  async ({ project_path, node_or_file }) => text(getImpact(resolveStore(project_path), node_or_file)),
);

await server.connect(new StdioServerTransport());
