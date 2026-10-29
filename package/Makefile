include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-site-checker2
PKG_VERSION:=2.0.0
PKG_RELEASE:=0.local3
PKG_LICENSE:=MIT
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-site-checker2
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=Site Checker 2.0
  DEPENDS:=+luci-base +rpcd +curl +jq +ca-bundle +setsid
endef

define Package/luci-app-site-checker2/conffiles
/etc/site-checker2/config.json
endef

define Build/Compile
endef

define Package/luci-app-site-checker2/install
	$(INSTALL_DIR) $(1)/usr $(1)/www $(1)/etc/site-checker2
	$(CP) ../files/usr/. $(1)/usr/
	$(CP) ../files/www/. $(1)/www/
	$(INSTALL_CONF) ../files/etc/site-checker2/config.json $(1)/etc/site-checker2/config.json
	chmod 755 $(1)/usr/libexec/site-checker2* $(1)/usr/libexec/rpcd/site-checker2
endef

define Package/luci-app-site-checker2/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] || /etc/init.d/rpcd reload
exit 0
endef

$(eval $(call BuildPackage,luci-app-site-checker2))
