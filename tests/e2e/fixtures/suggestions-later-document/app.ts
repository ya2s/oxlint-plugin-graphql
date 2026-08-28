// @ts-nocheck -- fixture file linted by oxlint, not type-checked; `gql` is not a real import.
const first = gql`
  query getUser {
    user {
      id
    }
  }
`;

const second = gql`
  query getUsers {
    users {
      id
    }
  }
`;

const typeDefs = gql`
  type User {
    userId: ID!
    name: String
  }
`;

export { first, second, typeDefs };
