import { configs as graphqlEslintConfigs } from "@graphql-eslint/eslint-plugin";

export type OxlintGraphqlConfig = {
  jsPlugins: string[];
  rules: Record<string, unknown>;
};

const PLUGIN_SPECIFIER = "oxlint-plugin-graphql";

// graphql-eslint's own flat configs cannot name a rule that doesn't exist upstream, so
// graphql/parse-error -- this plugin's replacement for ESLint's fatal parsing message, with no
// upstream equivalent -- has to be added explicitly after the mechanical rename below, on every
// ported config, rather than derived from graphql-eslint's config data like everything else
// here. Without it a user enabling a recommended preset would get no syntax-error reporting.
const PARSE_ERROR_RULE_ID = "graphql/parse-error";

function port(configName: string): OxlintGraphqlConfig {
  const source = (graphqlEslintConfigs as unknown as Record<string, { rules: Record<string, unknown> } | undefined>)[
    `flat/${configName}`
  ];
  if (!source) throw new Error(`unknown graphql-eslint config: flat/${configName}`);

  return {
    jsPlugins: [PLUGIN_SPECIFIER],
    rules: {
      ...Object.fromEntries(
        Object.entries(source.rules).map(([ruleId, value]) => [
          ruleId.replace("@graphql-eslint/", "graphql/"),
          value,
        ]),
      ),
      [PARSE_ERROR_RULE_ID]: "error",
    },
  };
}

export const schemaRecommended = port("schema-recommended");
export const schemaAll = port("schema-all");
export const schemaRelay = port("schema-relay");
export const operationsRecommended = port("operations-recommended");
export const operationsAll = port("operations-all");

export const configs: Record<string, OxlintGraphqlConfig> = {
  "schema-recommended": schemaRecommended,
  "schema-all": schemaAll,
  "schema-relay": schemaRelay,
  "operations-recommended": operationsRecommended,
  "operations-all": operationsAll,
};
