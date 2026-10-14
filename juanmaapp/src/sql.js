// Shared SQL fragments.

/** Full name of a sub-process: "Parent › Child" for second-order ones. */
export const typePath = (alias) =>
  `(COALESCE((SELECT tp.name || ' › ' FROM process_types tp WHERE tp.id = ${alias}.parent_id), '') || ${alias}.name)`;
