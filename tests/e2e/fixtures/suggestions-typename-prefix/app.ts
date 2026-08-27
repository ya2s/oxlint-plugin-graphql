// @ts-nocheck -- fixture file linted by oxlint, not type-checked; `gql` is not a real import.
const typeDefs = gql`
  type User {
    userId: ID!
    name: String
  }
`;

const query = gql`
  query getUser {
    user {
      id
    }
  }
`;

export { typeDefs, query };
