// @ts-nocheck -- fixture file linted by oxlint, not type-checked; `gql` is not a real import.
const q = gql`
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
      name
    }
  }
`;
