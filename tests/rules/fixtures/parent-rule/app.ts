// @ts-nocheck -- fixture file linted by oxlint, not type-checked; `gql` is not a real import.
const typeDefs = /* GraphQL */ `
  type Mutation {
    createUser: User
  }
`;

const q = gql`
  query getUser {
    user {
      id
      id
    }
  }
`;
