// 根据价格 排序，和 过滤掉 没有 quantity和remit_price 的数据
const processData = smartOrder => {

  const lineItems = smartOrder.line_items.map(item => {
    // console.info('item', item)
    return {   // 拿到订单的商品数量
      ...item,
      original_quantity: item.quantity,//保存原始数量值
      remit_price: item.price,//复制一个价格用于操作
      smart_discount_entries: item.smart_discount_entries || [] // 空
    }
  })
  //排序
  // 根据价格 排序，和 过滤掉 没有 quantity和remit_price 的数据
  smartOrder.line_items = lineItems
    .sort((a, b) => b.price - a.price)
    .filter(item => item.quantity > 0 && item.remit_price > 0);
  // console.info('smartOrder.line_items', smartOrder.line_items)
  return smartOrder;
};

const findValue = (target, smartOrder, lineItem) => {
  const targetStrs = target.split('.');
  if (targetStrs.length > 1) {
    switch (targetStrs[0]) {
      case 'line_items':
        return lineItem[targetStrs[1]];
      case 'order':
        return smartOrder[targetStrs[1]];
      case 'customer':
        return smartOrder.customer[targetStrs[1]];
    }
  }
  return '';
};
const SmartDiscount = (
  _smartOrder,  // 数据源
  _promos  // 脚本
) => {
  // 根据价格 排序，和 过滤掉 没有 quantity和remit_price 的数据
  let smartOrder = processData(_smartOrder);
  let current_node = { nodes: [] };

  let promos = _promos.map(item => {
    // console.log('item=====', item)
    return eval(item)
  });
  console.log('promos', promos)


  /*




    Promo.setName('4件D的Metal Keychain送一个')
    .addCondition([
                new Condition('line_items.category_id', '=', '63512'),
                new Condition('line_items.department_id', '=', '230073')
                ],
                new After('quantity', '/', 5)
               )
    .result(
             new Outcome(Choose(null,1),'-100%')
            )

    Promo.setName('Coupon: DimondD$100, -20')
    .setLevel(4)
    .addCondition(
      [
        new Condition('order.line_items_for_identify', 'find', '8378863'),
        new Condition('line_items.category_id', '=', '63526')
      ],
      new After('remit_price', '>=', 100)
    )
    .result(
      new Outcome(null, '-20')
    )


  */



  const _do = (node, nodeCache) => {
    //记忆化搜索算法逻辑
    const itemString = smartOrder.line_items.toString();
    // const itemCache = nodeCache.get(itemString);


    current_node = node;
    const amount = current_node.amount || 0;
    // if (itemCache) {
    //   const current = amount + itemCache.amount;
    //   if (current_node.amount > current) {
    //     current_node.amount = current;
    //   }
    //   current_node.nodes.push(itemCache);
    // } else {
    promos.forEach(promo => {
      //复制order对象
      const order = Object.assign({}, smartOrder);
      const lineItems = order.line_items.map(t => ({
        uuid: t.uuid,
        price: t.price,
        quantity: t.quantity,
        original_quantity: t.quantity,
        remit_price: t.price,
        department_id: t.department_id,
        category_id: t.category_id,
        product_id: t.product_id,
        listing_id: t.listing_id,
        amount: t.amount,
        smart_discount_entries: t.smart_discount_entries
      }));
      order.line_items = lineItems;
      //主校验逻辑
      const ls = promo.check(order);

      if (ls) {
        const new_node = promo.getReslut(ls);
        nodeCache.set(itemString, new_node);
        //当lineitems.length为0时不需要递归，这里判断比较繁琐，需要优化
        let processOrder = processData(ls);
        if (processOrder.line_items.length > 0) {
          SmartDiscount(ls, promos)._do(new_node, nodeCache);
        }
        const current = amount + new_node.amount;
        if (current_node.amount > current) {
          current_node.amount = current;
        }
        current_node.nodes.push(new_node);
      }
    });
    // }
  };

  const Do = () => {
    const levelPromos = [[]];
    //筛选promo
    promos.forEach(promo => {
      let isBack = false;
      for (let i = 0; i < smartOrder.line_items.length; i++) {
        const lienItem = smartOrder.line_items[i];
        for (let j = 0; j < promo.conditions.length; j++) {
          const condition = promo.conditions[j];
          for (let m = 0; m < condition.cs.length; m++) {
            const c = condition.cs[m];
            const value = findValue(c.target, smartOrder, lienItem);
            let matched = value == c.value;
            if (c.symbol == 'in') {
              matched = c.value.some(v => v == value);
            }
            if (matched) {
              if (!levelPromos[promo.level - 1]) {
                levelPromos[promo.level - 1] = [];
              }
              levelPromos[promo.level - 1].push(promo);
              isBack = true;
              break;
            }
          }
          if (isBack) {
            break;
          }
        }
        if (isBack) {
          break;
        }
      }
    });
    let result = [];
    let nodeCache = new Map();
    levelPromos.forEach(item => {
      promos = item;
      _do(current_node, nodeCache);
      result = getResultForLineItems();
      smartOrder = result;
      current_node = { nodes: [] };
      nodeCache = new Map();
    });
    return result;
  };

  const getResultForLineItems = () => {
    let tree = Object.assign({}, current_node);
    if (tree.nodes.length > 0) {
      tree.nodes.sort((a, b) => a.amount - b.amount);
      smartOrder.initial_discount = current_node.nodes[0].amount;
    }
    while (tree.nodes.length > 0) {
      tree.nodes.sort((a, b) => a.amount - b.amount);
      const node = tree.nodes[0];
      tree = node;
      const chooseItems = node.chooseItems || [];
      let total = 0;
      chooseItems.forEach(chooseItme => {
        total +=
          chooseItme.price *
          (chooseItme.original_quantity - chooseItme.quantity);
      });
      tree.nodes.sort((a, b) => a.amount - b.amount);
      const nextNode = tree.nodes[0];
      const nextAmount = nextNode ? nextNode.amount : 0;
      const remitAmount = tree.amount - nextAmount;
      const lineItems = smartOrder.line_items;
      let lineItemDiscountAmountTotal = 0;
      chooseItems.forEach((chooseItme, postion) => {
        lineItems.forEach((lineitem, index) => {
          if (lineitem.uuid == chooseItme.uuid) {
            const itemTotalPrice =
              chooseItme.price *
              (chooseItme.original_quantity - chooseItme.quantity);
            const itemReduceAmount = (remitAmount * itemTotalPrice) / total;
            lineItems[index].smart_discount_entries.push({
              discount_name: node.promo.name,
              amount:
                postion === chooseItems.length - 1
                  ? remitAmount - lineItemDiscountAmountTotal
                  : itemReduceAmount
            });
            lineItemDiscountAmountTotal += itemReduceAmount;
          }
        });
      });

      smartOrder.line_items = lineItems;
    }
    return smartOrder;
  };

  return {
    Do,
    _do,
    getResultForLineItmes: getResultForLineItems
  };
};

class Promo {
  constructor (name) {
    // 条件
    this.conditions = [];
    // 结果
    this.outcomes = [];
    // 打折名称
    this.name = name;
    // 水平
    this.level = 1;
  }

  static setName(name) {
    // console.log('name====', name)
    //
    return new Promo(name);
  }

  /**
   * level
   */
  setLevel(level) {
    this.level = level;
    return this;
  }

  /**
   * 添加条件
   */
  addCondition(cs, after) {
    // console.log('cs====', cs)

    /*
    cs 数组对象
    [
      {
      target: 'line_items.department_id',  // 字段
      symbol: '!=',  // 符号
      value: '-1'  // 值
      protype:{
        check: fn
      }
      }
    ]


    */

    // console.log('after====', after)
    this.conditions.push({ cs, after });
    return this;
  }

  /**
   * 作用的结果
   */
  result(outcome) {
    this.outcomes = outcome;
    return this;
  }

  /**
   *
   * @param smartOrder
   * @returns order - 调整过的(执行after逻辑之后的)order
   */
  getReslut(smartOrder) {
    return this.outcomes.calculate(smartOrder, this);
  }

  /**
   * 校验规则是否生效
   * @param smartOrder
   * @returns {boolean}
   */

  check(smartOrder) {
    //复制对象（如不需要可以不复制）
    let lineItems = smartOrder.line_items.map(t => ({
      uuid: t.uuid,
      price: t.price,
      quantity: t.quantity,
      original_quantity: t.quantity,
      remit_price: t.price,
      department_id: t.department_id,
      category_id: t.category_id,
      product_id: t.product_id,
      listing_id: t.listing_id,
      amount: t.amount,
      smart_discount_entries: t.smart_discount_entries
    }));
    let matched = true;
    for (let k = 0; k < this.conditions.length; k++) {
      const cs = this.conditions[k].cs;
      const after = this.conditions[k].after;
      //筛选满足条件的lineitem
      const matchedLineItem = lineItems.filter(lineItem => {
        let lineItemMatched = true;
        for (let j = 0; j < cs.length; j++) {
          const condition = cs[j];
          if (!condition.check(smartOrder, lineItem)) {//任何条件不满足
            lineItemMatched = false;
            break;
          }
        }
        return lineItemMatched;
      });
      if (matchedLineItem && matchedLineItem.length > 0) {
        const afterReslut = after.execute(matchedLineItem, smartOrder);
        if (!afterReslut) {
          matched = false;
          break;
        }
      } else {
        matched = false;
        break;
      }
      if (k != 0) {
        lineItems = lineItems.filter(item => item.remit_price > 0);
      }
    }
    smartOrder.line_items = lineItems;
    return matched && smartOrder;
  }
}

// 条件
class Condition {
  constructor (
    target,  // 字段
    symbol, // 符号 等于或者大于 或者小于
    value  // 值
  ) {
    // console.log('target,', target)
    // console.log('symbol', symbol)
    // console.log('value', value)
    this.target = target;
    this.symbol = symbol;
    this.value = value;
  }

  check(smartOrder, lineItem) {
    const key = findValue(this.target, smartOrder, lineItem);
    let result = false;
    switch (this.symbol) {
      case 'in':
        result = this.value.some(v => v == key);
        break;
      case 'find':
        result = key.some(v => v == this.value);
        break;
      case '>=':
        result = key >= this.value;
        break;
      case '<=':
        result = key <= this.value;
        break;
      case '=':
        result = key == this.value;
        break;
      case '!=':
        result = key != this.value;
        break;
    }
    return result;
  }
}

class After {
  constructor (target, symbol, value) {
    this.target = target;  //  字段
    this.symbol = symbol; // 符号
    this.value = value; // 值
    this.basePrice = -1; // 基本价格
  }

  setBasePrice(basePrice) {
    this.basePrice = basePrice;  // 设置基本价格
    return this;
  }

  execute(lineItems, smartOrder) { // 执行
    if (this.symbol === '/') {
      // 获取到所有商品的quantity 数量并且累加起来
      const totalQuantity = lineItems
        .map(item => item.quantity)
        .reduce((prev, next) => prev + next, 0);
      // 总数量 除以 当前值
      const value = Math.floor(totalQuantity / this.value);
      if (value) {
        // 浅拷贝
        Object.assign(smartOrder, {
          temporaryChange: {
            changeQuantity: value
          }
        });
        // 按从小到大价格排序商品
        lineItems.sort((a, b) => a.price - b.price);
        //
        this.value = value * this.value;
      }
      this.symbol = '=';
    }
    // 负数
    let result = -Number(this.value);
    // 循环单个商品
    for (let i = 0; i < lineItems.length; i++) {
      //获取单个商品
      const lineItem = lineItems[i];
      //
      const smartDiscounts = lineItem.smart_discount_entries || [];
      let quantity = 1;
      if (this.target != 'quantity') { // 如果 字段不是数量
        quantity = lineItem['quantity'];
        const discountAmount = smartDiscounts
          .map(smartDiscount => smartDiscount.amount)
          .reduce((prev, next) => prev + next, 0);
        result += discountAmount;
      }
      // 如果数量不等于 0
      if (quantity != 0) {
        if (this.basePrice !== -1 && this.basePrice > lineItem.price) {
          lineItem.basePrice = this.basePrice;
        } else {
          lineItem.basePrice = lineItem.price;
        }
        if (result !== -0.0001) {
          // 说明条件还不满足 >= 条件
          result += lineItem[this.target] * quantity;
          result = Number(result.toFixed(4));
        }
        if (result <= lineItem[this.target] * quantity) {
          if (this.target != 'quantity') {
            if (lineItem['quantity'] != lineItem['original_quantity']) {
              lineItem['original_quantity'] -= lineItem['quantity'];
            } else {
              lineItem[this.target] = 0;
            }
            lineItem['quantity'] = 0;
          } else {
            lineItem[this.target] = 0;
          }
        } else {
          lineItem[this.target] = result;
        }

        if (result >= 0) {
          if (this.symbol == '=') {
            break;
          } else if (this.symbol == '>=') {
            // 当>时为了让result 永远<lineItem[this.target] * quantity
            result = -0.0001;
          }
        }
      }
    }
    return result >= -0.0001;
  }
}

class Outcome {
  constructor (Choose, discount) {
    /*
     Choose ={
      //   // 条件
      //   conditions,
      //   // 数量
      //   quantity
      // };

      discount 优惠条件
    */
    this.Choose = Choose;
    this.discount = discount;
    this.result = [];
  }

  _filterItem(items = [], symbol, props, value) {
    // 过滤符合条件的
    return items.filter(item => {
      switch (symbol) {
        case '>=':
          // 大于
          return item[props] >= value;
        case '=':
          // 等于
          return item[props] == value;
        case '<=':
          // 小于
          return item[props] <= value;
        case '!=':
          // 不等于
          return item[props] <= value;
        case 'in':
          // 包含
          return value.includes(item[props]);
      }
    });
  }

  _filterItems(conditions = [], items = []) {
    if (conditions.length === 0 || items.length === 0) return;

    const [condition, ...restConditions] = conditions;

    if (condition === null) {
      this.result = items;
      return;
    }
    const [type, props, ...rest] = condition.target.split('.');
    const { symbol, value } = condition;

    if (type === 'line_items') {
      this.result = this._filterItem(items, symbol, props, value);
    }
    console.log('this.result=====', this.result)
    // 递归
    this._filterItems(restConditions, this.result);
  }

  _getAmount(discount, totalPrice, diff = 0) {
    let amount = 0;
    if (discount.includes('%')) {
      const percent = parseInt(discount, 10);
      amount = (totalPrice * percent) / 100;
    } else if (discount.includes('=')) {
      const net = parseInt(discount.replace('=', ''), 10);
      amount = net - totalPrice;
    } else {
      amount = parseInt(discount, 10) - diff;
    }

    return amount;
  }

  calculate(smartOrder, promo) {
    const discount = this.discount;
    const lineItems = smartOrder.line_items.map(t => ({
      uuid: t.uuid,
      price: t.price,
      quantity: t.quantity,
      original_quantity: t.original_quantity,
      remit_price: t.remit_price,
      department_id: t.department_id,
      category_id: t.category_id,
      product_id: t.product_id,
      listing_id: t.listing_id,
      amount: t.amount,
      smart_discount_entries: t.smart_discount_entries
    })).filter(
      item => item.original_quantity != item.quantity
    );
    const node = {
      nodes: [],
      promo,
      chooseItems: [],
      amount: 0
    };

    if (this.Choose === null) {
      node.chooseItems = lineItems;
      const totalPrice = lineItems
        .map(
          item =>
            (item.original_quantity - item.quantity) * item.price +
            (item.smart_discount_entries || [])
              .map(v => v.amount)
              .reduce((prev, next) => prev + next, 0)
        )
        .reduce((prev, next) => prev + next, 0);
      const diff = lineItems
        .map(
          item =>
            (item.original_quantity - item.quantity) *
            (item.price - item.basePrice)
        )
        .reduce((prev, next) => prev + next, 0);

      node.amount = this._getAmount(discount, totalPrice, diff);
    } else {
      if (smartOrder.temporaryChange) {
        this.Choose.quantity = smartOrder.temporaryChange.changeQuantity;
        smartOrder.temporaryChange = undefined;
      }
      const conditions = this.Choose.conditions;
      let quantity = this.Choose.quantity;
      if (quantity !== undefined) {
        let targetItems;
        if (!conditions) {
          targetItems = lineItems;
        } else {
          this._filterItems(conditions, lineItems);
          targetItems = this.result;
        }

        const len = targetItems.length;
        let totalPrice = 0;
        if (len !== 0) {
          for (let i = len - 1; i >= 0; i--) {
            const quantityDiff =
              targetItems[i].original_quantity - targetItems[i].quantity;
            if (quantity <= quantityDiff) {
              targetItems[i].quantity =
                targetItems[i].original_quantity - quantity;

              node.chooseItems.push(targetItems[i]);
              totalPrice +=
                targetItems[i].price * quantity +
                (targetItems[i].smart_discount_entries || [])
                  .map(v => v.amount)
                  .reduce((prev, next) => prev + next, 0);
              break;
            } else {
              quantity = quantity - quantityDiff;
              node.chooseItems.push(targetItems[i]);
              totalPrice +=
                targetItems[i].price * quantityDiff +
                (targetItems[i].smart_discount_entries || [])
                  .map(v => v.amount)
                  .reduce((prev, next) => prev + next, 0);
            }
          }
          node.amount = this._getAmount(discount, totalPrice);
        }
      } else {
        let targetItems;
        if (!conditions) {
          targetItems = lineItems;
        } else {
          this._filterItems(conditions, lineItems);
          targetItems = this.result;
        }

        const len = targetItems.length;
        let totalPrice = 0;
        if (len !== 0) {
          for (let i = len - 1; i >= 0; i--) {
            quantity =
              targetItems[i].original_quantity - targetItems[i].quantity;
            targetItems[i].quantity =
              targetItems[i].original_quantity - quantity;

            node.chooseItems.push(targetItems[i]);
            totalPrice +=
              targetItems[i].price * quantity +
              (targetItems[i].smart_discount_entries || [])
                .map(v => v.amount)
                .reduce((prev, next) => prev + next, 0);
          }
          node.amount = this._getAmount(discount, totalPrice);
        }
      }
    }

    return node;
  }
}

// 返回一个对象
const Choose = (conditions = null, quantity) => {
  return {
    // 条件
    conditions,
    // 数量
    quantity
  };
};

if (module) {
  module.exports = {
    SmartDiscount
  };
}
