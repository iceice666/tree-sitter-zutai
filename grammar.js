/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

/**
 * Tree-sitter grammar for Zutai general mode (.zt).
 *
 * This grammar tracks the implemented surface syntax used by the Rust frontend:
 * declarations, type expressions, tagged payloads, record updates, selective
 * projection, algebraic-effect punctuation, constraints, and witnesses.
 */
module.exports = grammar({
  name: 'zutai',

  extras: $ => [
    /\s+/,
    $.line_comment,
    $.doc_comment,
    $.block_comment,
  ],

  word: $ => $.identifier,

  conflicts: $ => [
    [$.record, $.type_record, $.block],
    [$.record, $.type_record, $.record_pattern],
    [$.record, $.block],
    [$.type_record, $.type_union],
    [$.tuple, $.type_tuple, $.tuple_pattern],
    [$.declaration, $.function_clause],
    [$.tagged_value, $.atom],
    [$.tagged_pattern, $.atom],
    [$._expr, $.postfix_expr],
    [$._atom_expr, $._type_atom],
    [$.literal, $._type_atom],
    [$._type_atom, $.type_tuple_item],
    [$.record, $.type_record],
    [$._field_id, $.local_binding],
    [$._atom_expr, $.union_variant],
    [$.tuple, $.type_tuple],
    [$.record, $.clause_block],
    [$.record, $.select_fields],
    [$._atom_expr, $._pattern],
    [$.record, $.record_pattern],
    [$.tuple, $.tuple_pattern],
    [$.tagged_tuple_payload, $.tagged_tuple_pattern_payload],
  ],

  rules: {
    source_file: $ => repeat(choice($.declaration, $._expr)),

    // ══════════════════════════════════════════════════════════════
    // Declarations
    // ══════════════════════════════════════════════════════════════

    declaration: $ => choice(
      $.witness_declaration,
      $.constraint_declaration,
      $.type_alias_declaration,
      $.import_declaration,
      $.function_declaration,
      $.typed_declaration,
      $.inferred_declaration,
      $.no_signature_function,
    ),

    inferred_declaration: $ => prec(5, seq(
      field('name', $.identifier),
      '::=',
      field('value', $._expr),
    )),

    typed_declaration: $ => prec(1, seq(
      field('name', $.identifier),
      '::',
      field('type', $._type_expr),
      '=',
      field('value', $._expr),
    )),

    import_declaration: $ => prec(3, seq(
      field('name', $.identifier),
      '::',
      'import',
      field('source', choice($.string, $.import_path)),
    )),

    type_alias_declaration: $ => prec(3, seq(
      field('name', $.identifier),
      '::',
      optional($.type_params),
      'type',
      field('type', $._type_expr),
    )),

    function_declaration: $ => prec(2, seq(
      field('name', $.identifier),
      '::',
      optional($.type_params),
      field('type', $._type_expr),
      repeat1($.function_clause),
    )),

    function_clause: $ => prec.right(seq(
      '=',
      repeat1(field('param', $._pattern)),
      optional(field('guard', $.guard)),
      '=>',
      field('body', $._expr),
      optional(';'),
    )),

    no_signature_function: $ => prec(1, seq(
      field('name', $.identifier),
      repeat1(field('param', $._pattern)),
      '=',
      field('body', $._expr),
    )),

    constraint_declaration: $ => prec(4, seq(
      field('name', $.identifier),
      '::',
      optional($.type_params),
      '@',
      field('target', $._type_atom),
      field('body', $.constraint_body),
      optional(field('derive', $.derive_clause)),
    )),

    constraint_body: $ => seq('{', repeat($.constraint_method), '}'),

    constraint_method: $ => seq(
      field('name', $.method_name),
      optional('?'),
      '::',
      optional($.type_params),
      field('type', $._type_expr),
      repeat($.function_clause),
      optional(';'),
    ),

    witness_declaration: $ => prec(4, seq(
      field('constraint', $.identifier),
      '@',
      field('target', $._type_atom),
      '::',
      optional($.type_params),
      field('body', $.witness_body),
    )),

    witness_body: $ => choice(
      'derive',
      seq('{', repeat($.witness_field), '}'),
    ),

    witness_field: $ => seq(
      field('name', $.method_name),
      '=',
      field('value', $._expr),
      optional(';'),
    ),

    derive_clause: $ => choice(
      'derive',
      seq('derive', '=', optional($.type_params), '=>', field('body', $._expr)),
    ),

    method_name: $ => choice(
      $.identifier,
      seq('(', $.operator_token, ')'),
    ),

    operator_token: $ => token(/[!$%&*+\-.\/:<=>?@^|~]+/),

    type_params: $ => seq('<', $.type_param, repeat(seq(',', $.type_param)), optional(','), '>'),

    type_param: $ => seq(
      field('name', $.identifier),
      optional(choice(
        seq(':', $.identifier, repeat(seq('+', $.identifier))),
        seq('::', $._type_expr),
      )),
    ),

    guard: $ => seq('if', $._expr),

    // ══════════════════════════════════════════════════════════════
    // Expressions
    // ══════════════════════════════════════════════════════════════

    _expr: $ => choice(
      $._atom_expr,
      $.application,
      $.select_operator,
      $.binary_op,
      $.field_access,
      $.optional_chain,
      $.record_update,
    ),

    _atom_expr: $ => choice(
      $.literal,
      $.tagged_value,
      $.atom,
      $.identifier,
      $.record,
      $.block,
      $.tuple,
      $.list,
      $.lambda,
      $.if_expr,
      $.match_expr,
      $.import_expr,
      $.type_form,
      $.select_expr,
      $.perform_expr,
      $.handle_expr,
      $.resume_expr,
      $.witness_reflect_expr,
      $.generator_expr,
      seq('(', $._expr, ')'),
    ),

    literal: $ => choice($.bool, $.float, $.integer, $.string),

    bool: $ => choice('true', 'false'),

    float: $ => token(seq(
      optional('-'),
      /[0-9]+/,
      choice(
        seq('.', /[0-9]+/, optional(seq(/[eE]/, optional(/[+-]/), /[0-9]+/))),
        seq(/[eE]/, optional(/[+-]/), /[0-9]+/),
      ),
      optional(choice(
        'i8', 'i16', 'i32', 'i64',
        'u8', 'u16', 'u32', 'u64',
        'f32', 'f64',
        'p32', 'p64',
        /p32e[0-9]+/,
        /p64e[0-9]+/,
      )),
    )),

    integer: $ => token(seq(optional('-'), /[0-9]+/, optional(choice(
      'i8', 'i16', 'i32', 'i64',
      'u8', 'u16', 'u32', 'u64',
      'f32', 'f64',
      'p32', 'p64',
      /p32e[0-9]+/,
      /p64e[0-9]+/,
    )))),

    string: $ => seq(
      '"',
      repeat(choice(
        token.immediate(/[^"\\]+/),
        $.escape_seq,
      )),
      '"',
    ),

    escape_seq: $ => token.immediate(seq('\\', /[^\r\n]/)),

    block_comment: $ => token(prec(3, /--\[(?:[^\]]|\](?:[^-]|-[^-]))*\]--/)),
    doc_comment: $ => token(prec(2, /--\|[^\n]*/)),
    line_comment: $ => token(prec(1, /--(?:[^\[|\n][^\n]*)?/)),

    atom: $ => seq('#', token.immediate(/[A-Za-z_][A-Za-z0-9_-]*/)),

    identifier: $ => /[A-Za-z_][A-Za-z0-9_]*/,
    hyphenated_identifier: $ => /[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_][A-Za-z0-9_]*)+/,
    _field_id: $ => choice($.identifier, $.hyphenated_identifier),
    field_identifier: $ => /[A-Za-z_][A-Za-z0-9_-]*/,

    tagged_value: $ => prec(2, seq(
      field('tag', $.atom),
      field('payload', choice($.record, $.tagged_tuple_payload)),
    )),

    tagged_tuple_payload: $ => seq(
      '(',
      optional(seq($._tuple_elem, repeat(seq(',', $._tuple_elem)), optional(','))),
      ')',
    ),

    record: $ => seq('{', repeat($.record_field), '}'),

    record_field: $ => seq(
      field('name', $._field_id),
      '=',
      optional(field('value', $._expr)),
      ';',
    ),

    block: $ => seq(
      '{',
      repeat($.local_binding),
      $._expr,
      repeat(seq(';', $._expr)),
      optional(';'),
      '}',
    ),

    local_binding: $ => seq(
      field('name', $.identifier),
      choice(
        seq(':=', field('value', $._expr)),
        seq(':', field('type', $._type_expr), '=', field('value', $._expr)),
      ),
      ';',
    ),

    list: $ => seq('[', repeat($.list_item), ']'),
    list_item: $ => seq($._expr, ';'),

    tuple: $ => choice(
      seq('(', ')'),
      seq('(', $._tuple_elem, ',', optional(seq($._tuple_elem, repeat(seq(',', $._tuple_elem)), optional(','))), ')'),
    ),

    _tuple_elem: $ => choice(
      seq($._field_id, '=', $._expr),
      $._expr,
    ),

    lambda: $ => seq('\\', repeat1($._pattern), '.', $._expr),

    if_expr: $ => seq(
      'if',
      field('condition', $._expr),
      'then',
      field('consequent', $._expr),
      'else',
      field('alternative', $._expr),
    ),

    match_expr: $ => seq(
      'match',
      field('scrutinee', $._expr),
      $.clause_block,
    ),

    clause_block: $ => seq('{', repeat($.match_arm), '}'),

    match_arm: $ => seq(
      '|',
      repeat1(field('pattern', $._pattern)),
      optional(field('guard', $.guard)),
      '=>',
      field('body', $._expr),
      ';',
    ),

    import_expr: $ => seq('import', choice($.string, $.import_path)),
    import_path: $ => /[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*/,

    type_form: $ => seq('type', $._type_expr),

    witness_reflect_expr: $ => seq('witness', field('constraint', $.identifier), '@', field('target', $._type_atom)),

    generator_expr: $ => seq('stream', '{', repeat($.yield_stmt), '}'),
    yield_stmt: $ => seq('yield', $._expr, ';'),

    select_expr: $ => prec(110, seq('select', field('receiver', $.postfix_expr), field('fields', $.select_fields))),
    select_operator: $ => prec.left(85, seq(field('receiver', $._expr), '>>=', field('fields', $.select_fields))),

    select_fields: $ => seq('{', repeat(seq($.field_identifier, ';')), '}'),

    perform_expr: $ => seq(choice('perform', '!'), field('operation', $.effect_path), field('argument', $._expr)),

    handle_expr: $ => prec(120, seq(
      'handle',
      field('expr', $._atom_expr),
      'with',
      '{',
      repeat($.handle_clause),
      '}',
    )),

    handle_clause: $ => seq(field('operation', $.effect_path), '=', field('body', $._expr), ';'),

    resume_expr: $ => seq(choice('resume', '^'), field('value', $._expr)),

    effect_path: $ => seq($.field_identifier, repeat(seq('.', $.field_identifier))),

    // ══════════════════════════════════════════════════════════════
    // Type expressions
    // ══════════════════════════════════════════════════════════════

    _type_expr: $ => choice(
      $._type_atom,
      $.type_application,
      $.type_select_operator,
      $.type_effect,
      $.type_arrow,
      $.type_access,
      $.type_optional_chain,
      $.type_optional,
    ),

    _type_atom: $ => choice(
      $.identifier,
      $.atom,
      $.bool,
      $.type_record,
      $.type_union,
      $.type_tuple,
      $.type_select_expr,
      $.expr_escape,
      seq('(', $._type_expr, ')'),
    ),

    type_application: $ => prec.left(90, seq($._type_expr, $._type_atom)),
    type_select_operator: $ => prec.left(85, seq(field('receiver', $._type_expr), '>>=', field('fields', $.select_fields))),
    type_effect: $ => prec.right(80, seq(field('base', $._type_expr), '!', field('effects', $.effect_row))),
    type_arrow: $ => prec.right(10, seq(field('from', $._type_expr), '->', field('to', $._type_expr))),
    type_access: $ => prec.left(100, seq(field('receiver', $._type_expr), '.', $.field_identifier)),
    type_optional_chain: $ => prec.left(100, seq(field('receiver', $._type_expr), '?.', $.field_identifier)),
    type_optional: $ => prec(100, seq($._type_expr, '?')),

    type_record: $ => seq('{', repeat(choice($.type_record_field, $.row_tail)), '}'),
    type_record_field: $ => seq(field('name', $._field_id), optional('?'), ':', field('type', $._type_expr), ';'),

    type_union: $ => seq('{', repeat1(choice($.union_variant, $.row_tail)), '}'),
    union_variant: $ => seq(field('tag', $.atom), optional(seq(':', field('payload', $._type_expr))), ';'),

    row_tail: $ => seq('...', optional($.identifier), ';'),

    type_tuple: $ => choice(
      seq('(', ')'),
      seq('(', $.type_tuple_item, ')'),
      seq('(', $.type_tuple_item, ',', optional(seq($.type_tuple_item, repeat(seq(',', $.type_tuple_item)), optional(','))), ')'),
    ),

    type_tuple_item: $ => choice(
      seq(field('name', $._field_id), ':', field('type', $._type_expr)),
      $._type_expr,
    ),

    type_select_expr: $ => seq('select', field('receiver', $._type_atom), field('fields', $.select_fields)),

    effect_row: $ => seq('{', optional(seq($.effect_op, repeat(seq(choice(',', ';'), $.effect_op)), optional(choice(',', ';')))), '}'),

    effect_op: $ => seq(
      field('operation', $.effect_path),
      optional(choice(
        seq(':', field('signature', $._type_expr)),
        field('payload', $._type_atom),
      )),
    ),

    expr_escape: $ => prec(1, seq('(', $._expr, ')')),

    // ══════════════════════════════════════════════════════════════
    // Postfix and operators
    // ══════════════════════════════════════════════════════════════

    postfix_expr: $ => choice($._atom_expr, $.field_access, $.optional_chain, $.record_update),

    application: $ => prec.left(90, seq($._expr, $._atom_expr)),

    record_update: $ => prec.left(100, seq(field('receiver', $._expr), 'with', '{', repeat($.record_field), '}')),

    field_access: $ => prec.left(100, seq(field('receiver', $._expr), '.', $.field_identifier)),
    optional_chain: $ => prec.left(100, seq(field('receiver', $._expr), '?.', $.field_identifier)),

    binary_op: $ => choice(
      prec.left(20, seq($._expr, '|>', $._expr)),
      prec.right(20, seq($._expr, '<|', $._expr)),
      prec.right(30, seq($._expr, '??', $._expr)),
      prec.left(40, seq($._expr, '||', $._expr)),
      prec.left(50, seq($._expr, '&&', $._expr)),
      prec.left(60, seq($._expr, choice('==', '!=', '<=', '>=', '<', '>'), $._expr)),
      prec.left(70, seq($._expr, choice('+', '-'), $._expr)),
      prec.left(80, seq($._expr, choice('*', '/'), $._expr)),
    ),

    // ══════════════════════════════════════════════════════════════
    // Patterns
    // ══════════════════════════════════════════════════════════════

    _pattern: $ => choice(
      $.literal,
      $.tagged_pattern,
      $.atom,
      $.identifier,
      $.wildcard,
      $.tuple_pattern,
      $.record_pattern,
    ),

    wildcard: $ => token(prec(1, '_')),

    tagged_pattern: $ => prec(2, seq(
      field('tag', $.atom),
      field('payload', choice($.record_pattern, $.tagged_tuple_pattern_payload)),
    )),

    tuple_pattern: $ => choice(
      seq('(', ')'),
      seq('(', $.tuple_pattern_item, ',', optional(seq($.tuple_pattern_item, repeat(seq(',', $.tuple_pattern_item)), optional(','))), ')'),
    ),

    tagged_tuple_pattern_payload: $ => seq(
      '(',
      optional(seq($.tuple_pattern_item, repeat(seq(',', $.tuple_pattern_item)), optional(','))),
      ')',
    ),

    tuple_pattern_item: $ => choice(
      seq($._field_id, '=', $._pattern),
      $._pattern,
    ),

    record_pattern: $ => seq('{', repeat($.record_pattern_field), '}'),
    record_pattern_field: $ => seq($._field_id, '=', $._pattern, ';'),
  },
});
