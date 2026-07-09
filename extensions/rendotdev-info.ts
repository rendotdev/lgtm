import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const packageName = "@rendotdev/pi-extensions";
const extensionName = "rendotdev-info";

const infoText = [
  `${packageName} is installed and loaded.`,
  "Included extensions:",
  `- ${extensionName}: package status command and tool`,
].join("\n");

const rendotdevInfoTool = defineTool({
  name: "rendotdev_info",
  label: "Rendotdev Info",
  description: "Show information about the installed Rendotdev Pi extensions package.",
  promptSnippet: "Show information about the installed Rendotdev Pi extensions package.",
  promptGuidelines: [
    "Use rendotdev_info when the user asks which Rendotdev Pi extensions are installed.",
  ],
  parameters: Type.Object({}),

  async execute() {
    return {
      content: [{ type: "text" as const, text: infoText }],
      details: {
        packageName,
        extensions: [extensionName],
      },
    };
  },
});

export default function rendotdevPiExtensions(pi: ExtensionAPI) {
  pi.registerTool(rendotdevInfoTool);

  pi.registerCommand("rendotdev-info", {
    description: "Show information about Rendotdev Pi extensions.",
    handler: async (_args, ctx) => {
      if (ctx.hasUI) {
        ctx.ui.notify(infoText, "info");
      }
    },
  });
}
