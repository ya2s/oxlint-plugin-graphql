// @ts-nocheck -- fixture file linted by oxlint, not type-checked; `gql` is not a real import.
import { gql } from "graphql-tag";

const first = gql`
  query {
    user {
      id
    }
  }
`;

const second = gql`
  query getUser {
    user {
      id
    }
  }
`;

export { first, second };
