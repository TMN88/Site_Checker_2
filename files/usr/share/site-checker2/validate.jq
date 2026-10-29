def ascii_host:
  type == "string" and length > 0 and length <= 253 and
  (explode | all(. == 45 or . == 46 or (. >= 48 and . <= 57) or (. >= 65 and . <= 90) or (. >= 97 and . <= 122))) and
  (split(".") | all(length > 0 and length <= 63 and (startswith("-")|not) and (endswith("-")|not)));
def config_valid:
  type == "object" and
  (.connect_timeout | type == "number" and floor == . and . >= 1 and . <= 10) and
  (.total_timeout | type == "number" and floor == . and . >= 1 and . <= 15) and
  .total_timeout >= .connect_timeout and
  (.parallel | type == "number" and floor == . and . >= 1 and . <= 4) and
  (.sites | type == "array" and length <= 32 and
    all(type == "object" and
        (.name | type == "string" and length > 0 and length <= 80 and (explode | all(. >= 32))) and
        (.domain | ascii_host) and
        (.enabled | type == "boolean"))) and
  ([.sites[].domain | ascii_downcase] | length == (unique | length));
config_valid
