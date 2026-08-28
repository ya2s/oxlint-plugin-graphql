// @ts-nocheck -- fixture file linted by oxlint, not type-checked; `gql` is not a real import.
const broken = gql`
  query User {
`;

const valid = gql`
  {
    user
  }
`;
