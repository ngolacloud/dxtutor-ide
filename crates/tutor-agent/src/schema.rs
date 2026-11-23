//! Validação mínima de JSON Schema para o input das ferramentas.
//!
//! Com `eager_input_streaming` o servidor deixa de validar o input, e um JSON cortado
//! pode até parecer um objecto válido — por isso **todo** o input é validado contra o
//! schema da ferramenta antes de ela correr. Cobre o subconjunto que as nossas
//! ferramentas usam: `type` (ou lista de tipos), `required`, `properties`,
//! `additionalProperties: false`, `items`, `enum`, `minimum`/`maximum`.

use serde_json::Value;

/// `Ok(())` ou a primeira violação, com o caminho (`input.path: …`).
pub fn validate(schema: &Value, v: &Value) -> Result<(), String> {
    check(schema, v, "input")
}

fn type_ok(t: &str, v: &Value) -> bool {
    match t {
        "string" => v.is_string(),
        "integer" => v.is_i64() || v.is_u64(),
        "number" => v.is_number(),
        "boolean" => v.is_boolean(),
        "array" => v.is_array(),
        "object" => v.is_object(),
        "null" => v.is_null(),
        _ => true, // tipos desconhecidos não bloqueiam
    }
}

fn kind(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(n) if n.is_i64() || n.is_u64() => "integer",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn check(s: &Value, v: &Value, path: &str) -> Result<(), String> {
    match &s["type"] {
        Value::String(t) if !type_ok(t, v) => {
            return Err(format!("{path}: esperado {t}, recebido {}", kind(v)));
        }
        Value::Array(ts) if !ts.iter().filter_map(Value::as_str).any(|t| type_ok(t, v)) => {
            return Err(format!("{path}: tipo {} não permitido", kind(v)));
        }
        _ => {}
    }
    if let Some(opts) = s["enum"].as_array() {
        if !opts.contains(v) {
            return Err(format!("{path}: valor fora de {}", s["enum"]));
        }
    }
    if let Some(x) = v.as_f64() {
        if let Some(min) = s["minimum"].as_f64() {
            if x < min {
                return Err(format!("{path}: {x} < mínimo {min}"));
            }
        }
        if let Some(max) = s["maximum"].as_f64() {
            if x > max {
                return Err(format!("{path}: {x} > máximo {max}"));
            }
        }
    }
    if let Some(obj) = v.as_object() {
        if let Some(req) = s["required"].as_array() {
            for k in req.iter().filter_map(Value::as_str) {
                if !obj.contains_key(k) {
                    return Err(format!("{path}.{k}: obrigatório"));
                }
            }
        }
        let props = s["properties"].as_object();
        for (k, val) in obj {
            match props.and_then(|p| p.get(k)) {
                Some(ps) => check(ps, val, &format!("{path}.{k}"))?,
                None if s["additionalProperties"] == Value::Bool(false) => {
                    return Err(format!("{path}.{k}: propriedade não permitida"));
                }
                None => {}
            }
        }
    }
    if let (Some(arr), Some(items)) = (v.as_array(), s.get("items")) {
        for (i, it) in arr.iter().enumerate() {
            check(items, it, &format!("{path}[{i}]"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 2000},
                "mode": {"enum": ["a", "b"]},
                "files": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["path"],
            "additionalProperties": false
        })
    }

    #[test]
    fn accepts_valid_input() {
        assert!(validate(
            &schema(),
            &json!({"path": "a.rs", "limit": 10, "mode": "a", "files": ["x"]})
        )
        .is_ok());
    }

    #[test]
    fn reports_the_first_violation_with_its_path() {
        let s = schema();
        assert_eq!(
            validate(&s, &json!({})).unwrap_err(),
            "input.path: obrigatório"
        );
        assert_eq!(
            validate(&s, &json!({"path": 3})).unwrap_err(),
            "input.path: esperado string, recebido integer"
        );
        assert!(validate(&s, &json!({"path": "a", "limit": 0}))
            .unwrap_err()
            .contains("mínimo"));
        assert!(validate(&s, &json!({"path": "a", "limit": 1.5}))
            .unwrap_err()
            .contains("esperado integer"));
        assert!(validate(&s, &json!({"path": "a", "mode": "z"}))
            .unwrap_err()
            .contains("valor fora"));
        assert_eq!(
            validate(&s, &json!({"path": "a", "files": ["x", 2]})).unwrap_err(),
            "input.files[1]: esperado string, recebido integer"
        );
        assert_eq!(
            validate(&s, &json!({"path": "a", "extra": 1})).unwrap_err(),
            "input.extra: propriedade não permitida"
        );
        assert!(validate(&s, &json!("texto")).is_err());
    }

    #[test]
    fn type_lists_and_open_objects() {
        let s = json!({"type": "object", "properties": {"x": {"type": ["string", "null"]}}});
        assert!(validate(&s, &json!({"x": null, "outra": 1})).is_ok());
        assert!(validate(&s, &json!({"x": 1})).is_err());
    }
}
